import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, TrendingUp, Briefcase, Download, ArrowLeft, CheckCircle, Target, Zap, XCircle, Sparkles, Rocket, Edit, BarChart3, Database, GraduationCap, ShieldCheck, UploadCloud, Search, Lightbulb, Link as LinkIcon, Info, Clock, Lock } from 'lucide-react';
import { config } from './config';
import './App.css';
import jsPDF from 'jspdf';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ============================================================================
// Specialized Header Formatting Helpers (shared across components)
// ============================================================================
const findUrlFromExtractedLinks = (lineText, extractedLinks, linkType) => {
  if (!extractedLinks || extractedLinks.length === 0) return null;
  
  // Extract key identifiers from line text (domain, username, email)
  const extractKeyParts = (text) => {
    const lower = text.toLowerCase();
    // Extract LinkedIn profile
    const linkedinMatch = lower.match(/linkedin\.com\/in\/([a-z0-9_-]+)/i);
    if (linkedinMatch) return `linkedin:${linkedinMatch[1]}`;
    // Extract GitHub username
    const githubMatch = lower.match(/github\.com\/([a-z0-9_-]+)/i);
    if (githubMatch) return `github:${githubMatch[1]}`;
    // Extract Kaggle username
    const kaggleMatch = lower.match(/kaggle\.com\/([a-z0-9_-]+)/i);
    if (kaggleMatch) return `kaggle:${kaggleMatch[1]}`;
    // Extract email
    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
    if (emailMatch) return `email:${emailMatch[1].toLowerCase()}`;
    // Extract any URL domain
    const urlMatch = lower.match(/(https?:\/\/)?(www\.)?([a-z0-9.-]+\.[a-z]{2,})/i);
    if (urlMatch) return `url:${urlMatch[3]}`;
    return null;
  };
  
  const lineKey = extractKeyParts(lineText);
  // ✅ Fallback mode: If no lineKey but line text contains keywords, try to match with extracted links
  if (!lineKey) {
    const lowerLineText = lineText.toLowerCase();
    
    // Check if line text contains keywords for the link type
    const hasKeyword = 
      (linkType === 'linkedin' && lowerLineText.includes('linkedin')) ||
      (linkType === 'github' && lowerLineText.includes('github')) ||
      (linkType === 'kaggle' && lowerLineText.includes('kaggle')) ||
      (linkType === 'email' && (lowerLineText.includes('@') || lowerLineText.includes('email')));
    
    if (hasKeyword) {
      for (const link of extractedLinks) {
        if (!link.url || !link.text) continue;
        
        const url = link.url.toLowerCase();
        const linkText = link.text.toLowerCase();
        
        // Match if link text contains the keyword or if URL matches the type
        const textMatches = 
          (linkType === 'linkedin' && (linkText.includes('linkedin') || url.includes('linkedin.com'))) ||
          (linkType === 'github' && (linkText.includes('github') || url.includes('github.com'))) ||
          (linkType === 'kaggle' && (linkText.includes('kaggle') || url.includes('kaggle.com'))) ||
          (linkType === 'email' && (linkText.includes('@') || url.includes('@') || url.startsWith('mailto:')));
        
        if (textMatches) {
          if (linkType === 'linkedin' && url.includes('linkedin.com')) {
            return link.url;
          } else if (linkType === 'github' && url.includes('github.com')) {
            return link.url;
          } else if (linkType === 'kaggle' && url.includes('kaggle.com')) {
            return link.url;
          } else if (linkType === 'email' && (url.startsWith('mailto:') || url.includes('@'))) {
            return url.startsWith('mailto:') ? url.replace('mailto:', '') : url;
          }
        }
      }
    }
    return null;
  }
  
  for (const link of extractedLinks) {
    if (!link.text || !link.url) continue;
    
    const linkKey = extractKeyParts(link.text);
    if (!linkKey) continue;
    
    // Match if keys are the same or if one contains the other
    const keysMatch = lineKey === linkKey || 
                     lineKey.includes(linkKey.split(':')[1]) || 
                     linkKey.includes(lineKey.split(':')[1]);
    
    if (keysMatch) {
      // Verify the link type matches
      const url = link.url.toLowerCase();
      if (linkType === 'linkedin' && url.includes('linkedin.com')) {
        return link.url; // Return full URL with query params
      } else if (linkType === 'github' && url.includes('github.com')) {
        return link.url;
      } else if (linkType === 'kaggle' && url.includes('kaggle.com')) {
        return link.url;
      } else if (linkType === 'email' && (url.startsWith('mailto:') || url.includes('@'))) {
        return url.startsWith('mailto:') ? url.replace('mailto:', '') : url;
      } else if (linkType === 'portfolio' && (url.startsWith('http://') || url.startsWith('https://'))) {
        // Only return if it's not a known social platform
        if (!url.includes('linkedin') && !url.includes('github') && !url.includes('kaggle')) {
          return link.url;
        }
      }
    }
  }
  
  return null;
};

const parseHeaderContent = (content, extractedLinks = []) => {
  if (!content && (!extractedLinks || extractedLinks.length === 0)) return null;
  
  const lines = content
    ? content.split('\n').map(l => l.trim()).filter(Boolean)
    : [];
  
  const headerData = {
    name: '',
    location: '',
    phone: '',
    email: '',
    linkedin: '',
    github: '',
    kaggle: '',
    portfolio: '',
    other: []
  };
  
  // ============== Line-based parsing ==============
  lines.forEach((line, idx) => {
    // First non-empty line is the name
    if (idx === 0 && !line.includes('@') && !line.match(/\d{10}/) && !line.includes('|')) {
      headerData.name = line.replace(/\*\*/g, '').trim();
      return;
    }
    
    // Special handling for lines with pipe separators (common in improved resumes)
    // Example: "email | phone | location | linkedin"
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim()).filter(Boolean);
      
      parts.forEach(part => {
        // Email detection
        if (!headerData.email) {
          const extractedEmail = findUrlFromExtractedLinks(part, extractedLinks, 'email');
          if (extractedEmail) {
            headerData.email = extractedEmail;
            return;
          }
          
          const emailMatch = part.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
          if (emailMatch) {
            headerData.email = emailMatch[1];
            return;
          }
        }
        
        // Phone detection
        if (!headerData.phone) {
          const phoneMatch = part.match(/(\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{4,10}|\d{10,12}/);
          if (phoneMatch) {
            headerData.phone = phoneMatch[0].trim();
            return;
          }
        }
        
        // Location detection (city, state/country format)
        if (!headerData.location && part.match(/,/) && !part.includes('@') && !part.match(/\d{10}/) && part.split(',').length === 2) {
          headerData.location = part;
          return;
        }
        
        // LinkedIn detection
        if (!headerData.linkedin) {
          if (part.toLowerCase().includes('linkedin') || part.match(/linkedin\.com/i)) {
            const extractedLinkedIn = findUrlFromExtractedLinks(part, extractedLinks, 'linkedin');
            if (extractedLinkedIn) {
              headerData.linkedin = extractedLinkedIn;
              return;
            }
            
            // Pattern matching for linkedin.com URLs
            if (part.match(/linkedin\.com/i)) {
              const linkedinMatch = part.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
              if (linkedinMatch) {
                headerData.linkedin = linkedinMatch[0].startsWith('http')
                  ? linkedinMatch[0]
                  : 'https://' + linkedinMatch[0];
                return;
              }
            }
          }
        }
        
        // GitHub detection
        if (!headerData.github && (part.toLowerCase().includes('github') || part.match(/github\.com/i))) {
          const extractedGitHub = findUrlFromExtractedLinks(part, extractedLinks, 'github');
          if (extractedGitHub) {
            headerData.github = extractedGitHub;
            return;
          }
          
          if (part.match(/github\.com/i)) {
            const githubMatch = part.match(/(https?:\/\/)?(www\.)?github\.com\/([a-zA-Z0-9_-]+)/i);
            if (githubMatch) {
              headerData.github = githubMatch[0].startsWith('http')
                ? githubMatch[0]
                : 'https://' + githubMatch[0];
              return;
            }
          }
        }
      });
      
      // After processing pipe-separated line, don't process it further
      return;
    }

    // Regular line-by-line parsing (for non-pipe-separated lines)
    // Email detection
    const extractedEmail = findUrlFromExtractedLinks(line, extractedLinks, 'email');
    if (extractedEmail) {
      headerData.email = extractedEmail;
      return;
    }

    const emailMatch = line.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
    if (emailMatch) {
      headerData.email = emailMatch[1];
      return;
    }

    // Phone detection - handle various formats including country codes
    const phoneMatch = line.match(/(\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{4,10}|\d{10,12}/);
    if (phoneMatch) {
      headerData.phone = phoneMatch[0].trim();
      return;
    }

    // ✅ LinkedIn detection (extracted links first)
    if (line.toLowerCase().includes('linkedin')) {
      const extractedLinkedIn = findUrlFromExtractedLinks(line, extractedLinks, 'linkedin');
      if (extractedLinkedIn) {
        headerData.linkedin = extractedLinkedIn;
        return;
      }
    }

    // Fallback: pattern matching if linkedin.com is in the text
    if (line.match(/linkedin\.com/i)) {
      const linkedinMatch = line.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
      if (linkedinMatch) {
        headerData.linkedin = linkedinMatch[0].startsWith('http')
          ? linkedinMatch[0]
          : 'https://' + linkedinMatch[0];
      } else {
        headerData.linkedin = line.includes('http') ? line : 'https://' + line;
      }
      return;
    }

    // GitHub detection
    const extractedGitHub = findUrlFromExtractedLinks(line, extractedLinks, 'github');
    if (extractedGitHub) {
      headerData.github = extractedGitHub;
      return;
    }

    if (line.match(/github\.com/i)) {
      const githubMatch = line.match(/(https?:\/\/)?(www\.)?github\.com\/([a-zA-Z0-9_-]+)/i);
      if (githubMatch) {
        headerData.github = githubMatch[0].startsWith('http')
          ? githubMatch[0]
          : 'https://' + githubMatch[0];
      }
      return;
    }

    // Kaggle detection
    const extractedKaggle = findUrlFromExtractedLinks(line, extractedLinks, 'kaggle');
    if (extractedKaggle) {
      headerData.kaggle = extractedKaggle;
      return;
    }

    if (line.match(/kaggle\.com/i)) {
      const kaggleMatch = line.match(/(https?:\/\/)?(www\.)?kaggle\.com\/([a-zA-Z0-9_-]+)/i);
      if (kaggleMatch) {
        headerData.kaggle = kaggleMatch[0].startsWith('http')
          ? kaggleMatch[0]
          : 'https://' + kaggleMatch[0];
      }
      return;
    }

    // Portfolio detection
    const extractedPortfolio = findUrlFromExtractedLinks(line, extractedLinks, 'portfolio');
    if (extractedPortfolio) {
      headerData.portfolio = extractedPortfolio;
      return;
    }

    if (line.match(/https?:\/\/|www\./i) && !line.match(/linkedin|github|kaggle/i)) {
      headerData.portfolio = line.startsWith('http') ? line : 'https://' + line;
      return;
    }

    // Location detection
    if (line.match(/,/) && !line.includes('@') && !line.match(/\d{10}/) && line.split(',').length === 2) {
      headerData.location = line;
      return;
    }

    // Other
    headerData.other.push(line);
  });

  // ============== ✅ Fallback extraction from extractedLinks only ==============
  if (!headerData.email) {
    headerData.email = findUrlFromExtractedLinks('', extractedLinks, 'email') || '';
  }

  if (!headerData.linkedin) {
    headerData.linkedin = findUrlFromExtractedLinks('', extractedLinks, 'linkedin') || '';
  }

  if (!headerData.github) {
    headerData.github = findUrlFromExtractedLinks('', extractedLinks, 'github') || '';
  }

  if (!headerData.kaggle) {
    headerData.kaggle = findUrlFromExtractedLinks('', extractedLinks, 'kaggle') || '';
  }

  if (!headerData.portfolio) {
    headerData.portfolio = findUrlFromExtractedLinks('', extractedLinks, 'portfolio') || '';
  }

  return headerData;
};

const renderImprovedHeader = (headerData) => {
  if (!headerData) return null;
  
  // Build contact line with separators (phone, email, LinkedIn)
  const contactParts = [];
  
  if (headerData.phone) {
    const cleanPhone = headerData.phone.replace(/\D/g, '');
    contactParts.push(
      `<a href="tel:+${cleanPhone}" style="color: #000000; text-decoration: none;">${headerData.phone}</a>`
    );
  }
  if (headerData.email) {
    contactParts.push(
      `<a href="mailto:${headerData.email}" style="color: #000000; text-decoration: none;">${headerData.email}</a>`
    );
  }
  if (headerData.linkedin) {
    contactParts.push(
      `<a href="${headerData.linkedin}" target="_blank" rel="noopener noreferrer" style="color: #000000; text-decoration: none;">LinkedIn</a>`
    );
  }
  
  // Other links (GitHub, Kaggle, Portfolio) - separate line if needed
  const otherLinkParts = [];
  if (headerData.github) {
    otherLinkParts.push(
      `<a href="${headerData.github}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">GitHub</a>`
    );
  }
  if (headerData.kaggle) {
    otherLinkParts.push(
      `<a href="${headerData.kaggle}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">Kaggle</a>`
    );
  }
  if (headerData.portfolio) {
    otherLinkParts.push(
      `<a href="${headerData.portfolio}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">Portfolio</a>`
    );
  }
  
  return (
    <div style={{ marginBottom: '1.2rem', textAlign: 'center' }}>
      {/* Name - Bold and Prominent */}
      <div style={{ 
        fontSize: '18pt', 
        fontWeight: 700, 
        color: '#000000', 
        marginBottom: '0.4rem', 
        lineHeight: '1.2', 
        fontFamily: 'Helvetica, Arial, sans-serif',
        letterSpacing: '0.02em'
      }}>
        {headerData.name}
      </div>
      
      {/* Location - First Line */}
      {headerData.location && (
        <div 
          style={{ 
            fontSize: '10pt', 
            color: '#000000', 
            marginBottom: '0.3rem', 
            lineHeight: '1.4', 
            fontFamily: 'Helvetica, Arial, sans-serif'
          }}
        >
          {headerData.location}
        </div>
      )}
      
      {/* Contact Info - Second Line (Phone, Email, LinkedIn) */}
      {contactParts.length > 0 && (
        <div 
          style={{ 
            fontSize: '10pt', 
            color: '#000000', 
            marginBottom: '0.3rem', 
            lineHeight: '1.4', 
            fontFamily: 'Helvetica, Arial, sans-serif'
          }}
          dangerouslySetInnerHTML={{ 
            __html: contactParts.join(' <span style="color: #9ca3af; margin: 0 0.3rem;">|</span> ')
          }}
        />
      )}
      
      {/* Other Links - Third Line (GitHub, Kaggle, Portfolio) if any */}
      {otherLinkParts.length > 0 && (
        <div 
          style={{ 
            fontSize: '10pt', 
            color: '#2563eb', 
            lineHeight: '1.4', 
            fontFamily: 'Helvetica, Arial, sans-serif'
          }}
          dangerouslySetInnerHTML={{ 
            __html: otherLinkParts.join(' <span style="color: #9ca3af; margin: 0 0.3rem;">|</span> ')
          }}
        />
      )}
      
      {/* Other info if any */}
      {headerData.other.map((item, idx) => (
        <div 
          key={idx}
          style={{ 
            fontSize: '9.5pt', 
            color: '#4b5563', 
            lineHeight: '1.4', 
            fontFamily: 'Helvetica, Arial, sans-serif',
            marginTop: '0.2rem'
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
};

const renderOriginalHeader = (headerData) => {
  if (!headerData) return null;
  
  return (
    <div style={{ marginBottom: '1rem' }}>
      {/* Name */}
      {headerData.name && (
        <div style={{ 
          fontSize: '16pt', 
          fontWeight: 700, 
          color: '#000000', 
          marginBottom: '0.5rem', 
          lineHeight: '1.2', 
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
          {headerData.name}
        </div>
      )}
      
      {/* Location */}
      {headerData.location && (
        <div style={{ 
          fontSize: '10pt', 
          color: '#000000', 
          marginBottom: '0.15rem', 
          lineHeight: '1.4', 
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
          {headerData.location}
        </div>
      )}
      
      {/* Phone */}
      {headerData.phone && (
        <div style={{ 
          fontSize: '10pt', 
          color: '#000000', 
          marginBottom: '0.15rem', 
          lineHeight: '1.4', 
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
          <a 
            href={`tel:+${headerData.phone.replace(/\D/g, '')}`} 
            style={{ color: '#000000', textDecoration: 'none' }}
          >
            {headerData.phone}
          </a>
        </div>
      )}
      
      {/* Email */}
      {headerData.email && (
        <div style={{ 
          fontSize: '10pt', 
          color: '#000000', 
          marginBottom: '0.15rem', 
          lineHeight: '1.4', 
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
          <a 
            href={`mailto:${headerData.email}`} 
            style={{ color: '#000000', textDecoration: 'none' }}
          >
            {headerData.email}
          </a>
        </div>
      )}
      
      {/* LinkedIn */}
      {headerData.linkedin && (
    <div style={{ 
      fontSize: '10pt', 
      color: 'rgb(0, 0, 0)', 
      marginBottom: '0.15rem', 
      lineHeight: '1.4', 
      fontFamily: 'Helvetica, Arial, sans-serif'
    }}>
          <a 
            href={headerData.linkedin} 
            target="_blank" 
            rel="noopener noreferrer"
        style={{ color: 'rgb(0, 0, 0)', textDecoration: 'none' }}
          >
            {headerData.linkedin.replace(/https?:\/\/(www\.)?/, '')}
          </a>
        </div>
      )}
      
      {/* GitHub */}
      {headerData.github && (
        <div style={{ 
          fontSize: '10pt', 
          color: '#2563eb', 
          marginBottom: '0.15rem', 
          lineHeight: '1.4', 
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
          <a 
            href={headerData.github} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#2563eb', textDecoration: 'none' }}
          >
            GitHub
          </a>
        </div>
      )}
      
      {/* Kaggle */}
      {headerData.kaggle && (
        <div style={{ 
          fontSize: '10pt', 
          color: '#2563eb', 
          marginBottom: '0.15rem', 
          lineHeight: '1.4', 
          fontFamily: 'Helvetica, Arial, sans-serif'
        }}>
          <a 
            href={headerData.kaggle} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ color: '#2563eb', textDecoration: 'none' }}
          >
            Kaggle
          </a>
        </div>
      )}
      
      {/* Other */}
      {headerData.other.map((item, idx) => (
        <div 
          key={idx}
          style={{ 
            fontSize: '9.5pt', 
            color: '#4b5563', 
            marginBottom: '0.15rem', 
            lineHeight: '1.4', 
            fontFamily: 'Helvetica, Arial, sans-serif'
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
};

const formatHeaderSection = (content, isImproved = false, extractedLinks = []) => {
  const headerData = parseHeaderContent(content, extractedLinks);
  
  if (!headerData) return null;
  
  return isImproved 
    ? renderImprovedHeader(headerData) 
    : renderOriginalHeader(headerData);
};

const ResumeComparison = ({ analysisData, fileUrl, fileType, formatResumeText }) => {
  const [currentView, setCurrentView] = useState('side-by-side');

  const switchView = (viewName) => {
    setCurrentView(viewName);
  };

  // ============================================================================
  // DIFF UTILITY FUNCTIONS (Only used for side-by-side view)
  // ============================================================================
  
  /**
   * Simple word-level diff algorithm for text comparison
   */
  const computeTextDiff = (originalText, improvedText) => {
    if (!originalText || !improvedText) return [];
    
    const originalWords = originalText.split(/(\s+)/);
    const improvedWords = improvedText.split(/(\s+)/);
    
    const diff = [];
    let origIdx = 0;
    let improvedIdx = 0;
    
    while (origIdx < originalWords.length || improvedIdx < improvedWords.length) {
      if (origIdx >= originalWords.length) {
        // All remaining improved words are additions
        diff.push({ type: 'add', text: improvedWords.slice(improvedIdx).join('') });
        break;
      }
      
      if (improvedIdx >= improvedWords.length) {
        // All remaining original words are removals
        diff.push({ type: 'remove', text: originalWords.slice(origIdx).join('') });
        break;
      }
      
      const origWord = originalWords[origIdx].toLowerCase().trim();
      const improvedWord = improvedWords[improvedIdx].toLowerCase().trim();
      
      if (origWord === improvedWord && origWord !== '') {
        // Match found
        diff.push({ type: 'equal', text: originalWords[origIdx] });
        origIdx++;
        improvedIdx++;
      } else {
        // Look ahead to find next match
        let foundMatch = false;
        let lookAhead = 1;
        
        while (lookAhead <= 5 && origIdx + lookAhead < originalWords.length) {
          const lookAheadWord = originalWords[origIdx + lookAhead].toLowerCase().trim();
          if (lookAheadWord === improvedWord && lookAheadWord !== '') {
            // Found match ahead - mark words as removed
            diff.push({ type: 'remove', text: originalWords.slice(origIdx, origIdx + lookAhead).join('') });
            origIdx += lookAhead;
            foundMatch = true;
            break;
          }
          lookAhead++;
        }
        
        if (!foundMatch) {
          lookAhead = 1;
          while (lookAhead <= 5 && improvedIdx + lookAhead < improvedWords.length) {
            const lookAheadWord = improvedWords[improvedIdx + lookAhead].toLowerCase().trim();
            if (lookAheadWord === origWord && lookAheadWord !== '') {
              // Found match ahead - mark words as added
              diff.push({ type: 'add', text: improvedWords.slice(improvedIdx, improvedIdx + lookAhead).join('') });
              improvedIdx += lookAhead;
              foundMatch = true;
              break;
            }
            lookAhead++;
          }
        }
        
        if (!foundMatch) {
          // No match found - treat as modification
          diff.push({ type: 'modify', text: originalWords[origIdx] });
          diff.push({ type: 'add', text: improvedWords[improvedIdx] });
          origIdx++;
          improvedIdx++;
        }
      }
    }
    
    return diff;
  };

  /**
   * Compute differences using metadata from analysisData
   */
  const computeResumeDiff = () => {
    if (!analysisData) return null;
    
    const diff = {
      skillsAdded: analysisData.improved?.skills_added || [],
      skillsEnhanced: analysisData.improved?.skills_enhanced || [],
      projectsAdded: analysisData.improved?.projects_added || [],
      originalSkills: analysisData.original?.has_skills || [],
      newSections: analysisData.improved?.sections_structure?.new_sections_added || [],
      sectionsStructure: {
        original: analysisData.original?.sections_structure?.sections || [],
        improved: analysisData.improved?.sections_structure?.sections || []
      }
    };
    
    // Extract base skills from enhanced skills (e.g., "Excel → Advanced Excel" -> "Excel")
    diff.enhancedBaseSkills = diff.skillsEnhanced.map(enhanced => {
      const match = enhanced.match(/^(.+?)\s*→/);
      return match ? match[1].trim() : null;
    }).filter(Boolean);
    
    return diff;
  };

  /**
   * Check if a skill should be highlighted as removed
   */
  const isSkillRemoved = (skillText, diffData) => {
    if (!diffData) return false;
    
    const normalizedText = skillText.toLowerCase().trim();
    
    // Check if it's in original skills but not in enhanced or added
    const wasInOriginal = diffData.originalSkills.some(origSkill => {
      const normalizedOrig = origSkill.toLowerCase().trim();
      return normalizedText.includes(normalizedOrig) || normalizedOrig.includes(normalizedText);
    });
    
    if (!wasInOriginal) return false;
    
    // Check if it's been enhanced (then it's modified, not removed)
    const isEnhanced = diffData.enhancedBaseSkills.some(baseSkill => {
      const normalizedBase = baseSkill.toLowerCase().trim();
      return normalizedText.includes(normalizedBase) || normalizedBase.includes(normalizedText);
    });
    
    if (isEnhanced) return false;
    
    // Check if it's in the improved resume (might be rephrased)
    // This is a simplified check - in practice, you'd need to parse the improved resume
    return true;
  };

  /**
   * Check if a skill should be highlighted as added
   */
  const isSkillAdded = (skillText, diffData) => {
    if (!diffData) return false;
    
    const normalizedText = skillText.toLowerCase().trim();
    return diffData.skillsAdded.some(addedSkill => {
      const normalizedAdded = addedSkill.toLowerCase().trim();
      return normalizedText.includes(normalizedAdded) || normalizedAdded.includes(normalizedText);
    });
  };

  /**
   * Check if a skill should be highlighted as enhanced/modified
   */
  const isSkillEnhanced = (skillText, diffData) => {
    if (!diffData) return false;
    
    const normalizedText = skillText.toLowerCase().trim();
    return diffData.enhancedBaseSkills.some(baseSkill => {
      const normalizedBase = baseSkill.toLowerCase().trim();
      return normalizedText.includes(normalizedBase) || normalizedBase.includes(normalizedText);
    });
  };

  /**
   * Check if a project should be highlighted as added
   */
  const isProjectAdded = (projectTitle, diffData) => {
    if (!diffData) return false;
    
    const cleanTitle = projectTitle
      .replace(/\[CN Project\]/g, '')
      .split('|')[0]
      .trim()
      .toLowerCase();
    
    return diffData.projectsAdded.some(addedProject => {
      const normalizedAdded = addedProject.toLowerCase().trim();
      return cleanTitle === normalizedAdded || 
             cleanTitle.includes(normalizedAdded) ||
             normalizedAdded.includes(cleanTitle);
    });
  };

  /**
   * Format text with diff highlighting
   */
  // const formatTextWithDiff = (text, diffType) => {
  //   if (!text || !diffType) return text;
    
  //   const className = diffType === 'add' ? 'diff-add' : 
  //                    diffType === 'remove' ? 'diff-remove' : 
  //                    diffType === 'modify' ? 'diff-modify' : '';
    
  //   return <span className={className}>{text}</span>;
  // };

  /**
   * Enhanced formatSectionContent with diff support
   * Only used in side-by-side view
   */
    const formatSectionContentWithDiff = (content, sectionType, isOriginal, diffData, originalContent = null, extractedLinks = []) => {
    if (!content) return null;
      if (sectionType === 'header') {
        return formatHeaderSection(content, !isOriginal, extractedLinks);
      }
    
    // Normalize Unicode bullets
    let normalizedContent = content
      .replace(/\uf0b7/g, '•')
      .replace(/[\u2022\u2023\u2043\u2219\u25E6\u25AA\u25AB\u25CF\u25CB\u25D8]/g, '•');
    
    if (sectionType === 'header') {
      normalizedContent = normalizedContent.replace(/\*\*(.*?)\*\*/g, '$1');
    }
    
    const lines = normalizedContent.split('\n');
    const formattedLines = [];
    
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (idx > 0 && idx < lines.length - 1 && lines[idx - 1].trim() && lines[idx + 1].trim()) {
          formattedLines.push({ type: 'break', key: `break-${idx}` });
        }
        return;
      }
      
      // Detect line types
      const isBullet = /^[•·\-*]/.test(trimmed) || /^\d+\./.test(trimmed);
      const isJobHeader = /^.+ \| .+$/.test(trimmed) && sectionType === 'experience';
      const isDateLine = /^\d{4}|\w+ \d{4}|Present|Current/i.test(trimmed) && sectionType === 'experience';
      const isDegreeLine = /\b(B\.Tech|B\.E\.|B\.Sc\.|M\.Tech|M\.B\.A|Degree)\b/i.test(trimmed) && sectionType === 'education';
      const isNameLine = sectionType === 'header' && !trimmed.includes('|') && !trimmed.includes('@') && trimmed.length < 50 && trimmed.split(' ').length <= 4;
      const isContactLine = sectionType === 'header' && 
                            (trimmed.includes('@') || 
                             /Email|Phone|Mob|Mobile|Contact/i.test(trimmed) ||
                             /\d{10}/.test(trimmed));
      const isProjectTitle = sectionType === 'projects' && 
                             !isBullet && 
                             !trimmed.toLowerCase().startsWith('technologies:') &&
                             (trimmed.includes('[') || 
                              (trimmed.length > 10 && trimmed.length < 100 && 
                               !trimmed.includes(':') && 
                               !trimmed.match(/^\d+[.)]/)));
      const isTechnologiesLine = sectionType === 'projects' && 
                                  /^Technologies:\s*/i.test(trimmed);
      
      // Determine diff type for this line
      let diffType = null;
      if (sectionType === 'skills') {
        // Extract individual skills from the line (handle comma-separated, colon-separated)
        const skillLine = trimmed.replace(/^[•·\-*\d+.]\s*/, ''); // Remove bullet
        const categoryMatch = skillLine.match(/^[^:]+:\s*(.+)$/);
        const skillsText = categoryMatch ? categoryMatch[1] : skillLine;
        const skillsInLine = skillsText.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        // Check each skill in the line
        let hasAdded = false;
        let hasEnhanced = false;
        let hasRemoved = false;
        
        skillsInLine.forEach(skill => {
          if (!isOriginal) {
            if (isSkillAdded(skill, diffData)) {
              hasAdded = true;
            } else if (isSkillEnhanced(skill, diffData)) {
              hasEnhanced = true;
            }
          } else {
            if (isSkillEnhanced(skill, diffData)) {
              hasEnhanced = true;
            } else if (isSkillRemoved(skill, diffData)) {
              hasRemoved = true;
            }
          }
        });
        
        // Determine overall diff type for the line
        if (isOriginal) {
          if (hasEnhanced) {
            diffType = 'modify';
          } else if (hasRemoved && !hasEnhanced) {
            diffType = 'remove';
          }
        } else {
          if (hasAdded && !hasEnhanced) {
            diffType = 'add';
          } else if (hasEnhanced) {
            diffType = 'modify';
          } else if (hasAdded && hasEnhanced) {
            diffType = 'modify'; // Prefer modify if both
          }
        }
      } else if (sectionType === 'projects' && isProjectTitle) {
        if (!isOriginal && isProjectAdded(trimmed, diffData)) {
          diffType = 'add';
        }
      } else if (sectionType === 'summary' && originalContent) {
        // For summary, do text diff
        const originalSummary = originalContent.split('\n').find(l => l.trim()) || '';
        if (originalSummary && trimmed) {
          const textDiff = computeTextDiff(originalSummary, trimmed);
          // If significant differences, mark as modify
          const hasChanges = textDiff.some(d => d.type !== 'equal');
          if (hasChanges) {
            diffType = 'modify';
          }
        }
      }
      
      if (isNameLine) {
        formattedLines.push({ type: 'name-header', content: trimmed, key: `name-${idx}`, diffType });
      } else if (isContactLine) {
        formattedLines.push({ type: 'contact', content: trimmed, key: `contact-${idx}`, diffType });
      } else if (isJobHeader) {
        formattedLines.push({ type: 'job-header', content: trimmed, key: `job-${idx}`, diffType });
      } else if (isDateLine) {
        formattedLines.push({ type: 'date', content: trimmed, key: `date-${idx}`, diffType });
      } else if (isDegreeLine) {
        formattedLines.push({ type: 'degree', content: trimmed, key: `degree-${idx}`, diffType });
      } else if (isProjectTitle) {
        formattedLines.push({ type: 'project-title', content: trimmed, key: `project-${idx}`, diffType });
      } else if (isTechnologiesLine) {
        const techContent = trimmed.replace(/^Technologies:\s*/i, '');
        formattedLines.push({ type: 'technologies', content: techContent, key: `tech-${idx}`, diffType });
      } else if (isBullet) {
        const bulletText = trimmed.replace(/^[•·\-*\d+.]\s*/, '');
        formattedLines.push({ type: 'bullet', content: bulletText, key: `bullet-${idx}`, diffType });
      } else {
        formattedLines.push({ type: 'text', content: trimmed, key: `text-${idx}`, diffType });
      }
    });
    
    // Render formatted lines with diff highlighting
    const lineHeight = 1.5;
    const smallLineHeight = 1.4;
    const sectionSpacing = '0.5rem';
    const bulletMargin = '0.2rem';
    const textMargin = '0.2rem';
    
    return formattedLines.map((item) => {
      const diffClassName = item.diffType ? `diff-${item.diffType === 'add' ? 'add' : item.diffType === 'remove' ? 'remove' : 'modify'}` : '';
      
      switch (item.type) {
        case 'break':
          return <br key={item.key} />;
        
        case 'name-header':
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '12pt', fontWeight: 700, color: '#000000', marginBottom: sectionSpacing, lineHeight: '1.2', fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {item.content}
            </div>
          );
        
        case 'contact':
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '9pt', color: '#000000', marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {item.content}
            </div>
          );
        
        case 'job-header':
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '10pt', fontWeight: 700, color: '#000000', marginTop: sectionSpacing, marginBottom: '0.1rem', lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {item.content}
            </div>
          );
        
        case 'date':
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '9pt', color: '#000000', marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {item.content}
            </div>
          );
        
        case 'degree':
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '10pt', fontWeight: 700, color: '#000000', marginTop: sectionSpacing, marginBottom: '0.1rem', lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {item.content}
            </div>
          );
        
        case 'project-title':
          const cleanProjectTitle = item.content
            .replace(/\[CN Project\]/g, '')
            .split('|')[0]
            .trim();
          
          const projectsAdded = diffData?.projectsAdded || [];
          const isAddedProject = projectsAdded.some(addedProject => {
            const normalizedAdded = addedProject.toLowerCase().trim();
            const normalizedTitle = cleanProjectTitle.toLowerCase().trim();
            return normalizedTitle === normalizedAdded || 
                   normalizedTitle.includes(normalizedAdded) ||
                   normalizedAdded.includes(normalizedTitle);
          });
          
          const displayText = item.content.replace(/\[CN Project\]/g, '').trim();
          
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '10pt', fontWeight: 700, color: '#000000', marginTop: sectionSpacing, marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
              <span>{displayText}</span>
              {isAddedProject && (
                <img 
                  src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTEMYetPQ2J3r1xQQ36xkvL0HRXp7p_YH4mgA&s" 
                  alt="Coding Ninjas" 
                  style={{ 
                    height: '12px', 
                    width: 'auto', 
                    verticalAlign: 'middle',
                    display: 'inline-block'
                  }} 
                />
              )}
            </div>
          );
        
        case 'technologies':
          return (
            <div key={item.key} className={diffClassName} style={{ fontSize: '10pt', color: '#000000', marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              <span style={{ fontWeight: 700 }}>Technologies:</span> {item.content}
            </div>
          );
        
        case 'bullet':
          return (
            <div key={item.key} className={diffClassName} style={{ paddingLeft: '0.4rem', marginBottom: bulletMargin, color: '#000000', fontSize: '10pt', lineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              <span style={{ marginRight: '0.3rem' }}>-</span>
              <span>{item.content}</span>
            </div>
          );
        
        case 'text':
        default:
          return (
            <div key={item.key} className={diffClassName} style={{ marginBottom: textMargin, color: '#000000', fontSize: '10pt', lineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {item.content}
            </div>
          );
      }
    });
  };

  // Compute diff data once
  const diffData = computeResumeDiff();

  /**
   * Render original resume with diff highlighting (only for side-by-side view)
   */
  const renderOriginalWithDiff = () => {
    const extractedLinks = analysisData?.extracted_links || [];
    if (currentView !== 'side-by-side' || !diffData) {
      // Fallback to regular rendering if not in side-by-side view
    return formatResumeText(analysisData.original.resume_text, analysisData.original.sections_structure, false, extractedLinks);
    }
    
    // Parse sections
    const sections = parseResumeSectionsSimple(analysisData.original.resume_text, analysisData.original.sections_structure);
    
    return (
      <div style={{ fontFamily: 'Helvetica, Arial, sans-serif', color: '#000000' }}>
        {sections.map((section, sectionIdx) => {
          const isHeaderSection = section.type === 'header';
          
          if (isHeaderSection) {
            return (
              <div key={sectionIdx} style={{ marginBottom: '0.8rem' }}>
                {formatSectionContentWithDiff(
                  section.content, 
                  section.type, 
                  true, // isOriginal
                  diffData,
                  null,
                  extractedLinks
                )}
              </div>
            );
          }
          
          return (
            <div key={sectionIdx} style={{ marginBottom: '0.85rem' }}>
              <div style={{
                marginBottom: '0.25rem',
                paddingBottom: '0.08rem',
                borderBottom: '0.5px solid #000000',
                marginTop: sectionIdx === 0 ? '0' : '0.7rem'
              }}>
                <h3 style={{
                  margin: 0,
                  fontSize: '11pt',
                  fontWeight: 700,
                  color: '#000000',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  lineHeight: '1.2'
                }}>
                  {section.name}
                </h3>
              </div>
              <div style={{ padding: 0, background: '#ffffff', marginTop: '0.25rem' }}>
                {formatSectionContentWithDiff(
                  section.content, 
                  section.type, 
                  true, // isOriginal
                  diffData,
                  section.content,
                  extractedLinks
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /**
   * Render improved resume with diff highlighting (only for side-by-side view)
   */
  const renderImprovedWithDiff = () => {
    const extractedLinks = analysisData?.extracted_links || [];
    if (currentView !== 'side-by-side' || !diffData) {
      // Fallback to regular rendering if not in side-by-side view
    return formatResumeText(analysisData.improved.resume_text, analysisData.improved.sections_structure, true, extractedLinks);
    }
    
    // Parse sections
    const sections = parseResumeSectionsSimple(analysisData.improved.resume_text, analysisData.improved.sections_structure);
    const originalSections = parseResumeSectionsSimple(analysisData.original.resume_text, analysisData.original.sections_structure);
    
    // Filter out empty PROFESSIONAL EXPERIENCE sections
    const sectionsWithContent = sections.filter(section => {
      const content = section.content || '';
      const hasContent = content.trim().length > 0;
      // If it's an experience section with no content, exclude it
      if (section.type === 'experience' && !hasContent) {
        return false;
      }
      return hasContent;
    });
    
    return (
      <div style={{ fontFamily: 'Helvetica, Arial, sans-serif', color: '#000000' }}>
        {sectionsWithContent.map((section, sectionIdx) => {
          const isHeaderSection = section.type === 'header';
          const originalSection = originalSections.find(s => s.type === section.type);
          
          if (isHeaderSection) {
            return (
              <div key={sectionIdx} style={{ marginBottom: '0.8rem' }}>
                {formatSectionContentWithDiff(
                  section.content, 
                  section.type, 
                  false, // isOriginal
                  diffData,
                  originalSection?.content,
                  extractedLinks
                )}
              </div>
            );
          }
          
          // Check if this is a new section
          const isNewSection = diffData.newSections.some(newSection => 
            newSection.toLowerCase() === section.name.toLowerCase()
          );
          
          return (
            <div key={sectionIdx} style={{ marginBottom: '0.85rem' }}>
              <div style={{
                marginBottom: '0.25rem',
                paddingBottom: '0.08rem',
                borderBottom: '0.5px solid #000000',
                marginTop: sectionIdx === 0 ? '0' : '0.7rem'
              }}>
                <h3 style={{
                  margin: 0,
                  fontSize: '11pt',
                  fontWeight: 700,
                  color: '#000000',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  lineHeight: '1.2'
                }}>
                  {section.name}
                  {isNewSection && (
                    <span className="diff-add" style={{ marginLeft: '0.5rem', fontSize: '9pt', fontWeight: 500 }}>
                      (NEW)
                    </span>
                  )}
                </h3>
              </div>
              <div style={{ padding: 0, background: '#ffffff', marginTop: '0.25rem' }}>
                {formatSectionContentWithDiff(
                  section.content, 
                  section.type, 
                  false, // isOriginal
                  diffData,
                  originalSection?.content,
                  extractedLinks
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  
  // Helper function to parse resume sections (needed for diff rendering)
  const parseResumeSectionsSimple = (text, sectionsInfo = null) => {
    if (!text) return [];
    
    const lines = text.split('\n');
    const sections = [];
    let currentSection = null;
    let currentContent = [];
    let headerLines = [];
    let headerCaptured = false;
    
    const sectionPatterns = {
      header: /^(HEADER|CONTACT INFORMATION|CONTACT|NAME|PERSONAL DETAILS)$/i,
      summary: /^(PROFESSIONAL SUMMARY|SUMMARY|OBJECTIVE|CAREER OBJECTIVE|PROFILE|ABOUT)$/i,
      skills: /^(TECHNICAL SKILLS|SKILLS|CORE COMPETENCIES|KEY SKILLS|COMPETENCIES|TECHNICAL COMPETENCIES)$/i,
      experience: /^(PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EMPLOYMENT HISTORY|CAREER HISTORY|WORK HISTORY)$/i,
      education: /^(EDUCATION|ACADEMIC BACKGROUND|ACADEMIC QUALIFICATIONS|QUALIFICATIONS)$/i,
      projects: /^(PROJECTS|KEY PROJECTS|PORTFOLIO PROJECTS|SELECTED PROJECTS|PROJECT EXPERIENCE)$/i,
      certifications: /^(CERTIFICATIONS|CERTIFICATES|PROFESSIONAL CERTIFICATIONS)$/i,
      awards: /^(AWARDS|ACHIEVEMENTS|HONORS|RECOGNITIONS)$/i,
      languages: /^(LANGUAGES|LANGUAGE PROFICIENCY)$/i,
      other: /^[A-Z][A-Z\s&/]+$/
    };
    
    const detectSectionType = (line) => {
      for (const [type, pattern] of Object.entries(sectionPatterns)) {
        if (pattern.test(line.trim())) {
          return type === 'other' ? 'other' : type;
        }
      }
      return null;
    };
    
    lines.forEach((line) => {
      const trimmed = line.trim();
      const sectionType = detectSectionType(trimmed);
      
      if (sectionType) {
        if (!headerCaptured && headerLines.length > 0) {
          sections.push({
            name: 'HEADER',
            type: 'header',
            content: headerLines.join('\n').trim()
          });
          headerCaptured = true;
          headerLines = [];
        }
        
        if (currentSection) {
          sections.push({
            ...currentSection,
            content: currentContent.join('\n').trim()
          });
        }
        currentSection = {
          name: trimmed,
          type: sectionType
        };
        currentContent = [];
      } else if (trimmed) {
        if (!currentSection && !headerCaptured) {
          headerLines.push(line);
        } else {
          currentContent.push(line);
        }
      } else if (currentContent.length > 0) {
        currentContent.push('');
      }
    });
    
    if (!headerCaptured && headerLines.length > 0) {
      sections.push({
        name: 'HEADER',
        type: 'header',
        content: headerLines.join('\n').trim()
      });
    }
    
    if (currentSection) {
      sections.push({
        ...currentSection,
        content: currentContent.join('\n').trim()
      });
    }
    
    return sections.length > 0 ? sections : [{
      name: 'RESUME CONTENT',
      type: 'other',
      content: text
    }];
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      border: '1px solid #e2e8f0',
      marginBottom: '2rem',
      overflow: 'hidden'
    }}>
      <style>{`
        .diff-add {
          background-color: rgba(52, 211, 153, 0.2);
          border-radius: 0.25rem;
          padding: 0 0.25rem;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .diff-remove {
          background-color: rgba(248, 113, 113, 0.2);
          text-decoration: line-through;
          text-decoration-color: rgba(220, 38, 38, 0.5);
          border-radius: 0.25rem;
          padding: 0 0.25rem;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .diff-modify {
          background-color: rgba(139, 92, 246, 0.2);
          border-radius: 0.25rem;
          padding: 0 0.25rem;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
      `}</style>

      {/* Header with controls */}
      <div style={{ padding: '2rem 2rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem' }}>
          Resume Comparison
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '2rem' }}>
          Visually compare the changes between your original and improved resume.
        </p>

        <div style={{ 
          display: 'flex', 
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          {/* View Toggle Buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            background: '#f1f5f9',
            padding: '0.25rem',
            borderRadius: '9999px',
            border: '1px solid #e2e8f0'
          }}>
            <button
              onClick={() => switchView('original')}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                borderRadius: '9999px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: currentView === 'original' ? 'white' : 'transparent',
                color: currentView === 'original' ? '#6366F1' : '#64748b',
                boxShadow: currentView === 'original' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Original
            </button>
            <button
              onClick={() => switchView('side-by-side')}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                borderRadius: '9999px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: currentView === 'side-by-side' ? 'white' : 'transparent',
                color: currentView === 'side-by-side' ? '#6366F1' : '#64748b',
                boxShadow: currentView === 'side-by-side' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Side-by-Side
            </button>
            <button
              onClick={() => switchView('improved')}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                borderRadius: '9999px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: currentView === 'improved' ? 'white' : 'transparent',
                color: currentView === 'improved' ? '#6366F1' : '#64748b',
                boxShadow: currentView === 'improved' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Improved
            </button>
          </div>

          {/* Legend - Only show in Side-by-Side view */}
          {currentView === 'side-by-side' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#f87171',
                  border: '2px solid #fecaca'
                }} />
                <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>Removed</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#34d399',
                  border: '2px solid #a7f3d0'
                }} />
                <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>Added</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#a78bfa',
                  border: '2px solid #ddd6fe'
                }} />
                <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>Modified</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content Views */}
      <div style={{ padding: '0 2rem 2rem' }}>
        {/* Side-by-Side View */}
        {currentView === 'side-by-side' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
            gap: '2rem',
            fontSize: '0.875rem',
            lineHeight: '1.6'
          }}>
            {/* Original Resume Column */}
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#dc2626',
                borderRadius: '8px 8px 0 0',
                borderBottom: '1px solid rgba(239, 68, 68, 0.2)'
              }}>
                <XCircle size={20} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Original Resume</h3>
              </div>
              <div style={{
                background: '#f9fafb',
                padding: '1.5rem',
                borderRadius: '0 0 8px 8px',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                maxHeight: '600px',
                overflowY: 'auto'
              }}>
                {fileUrl && fileType === 'application/pdf' ? (
                  <iframe
                    src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=1`}
                    style={{
                      width: '100%',
                      height: '550px',
                      border: 'none',
                      display: 'block',
                      borderRadius: '6px'
                    }}
                    title="Original Resume PDF"
                  />
                ) : (
                  renderOriginalWithDiff()
                )}
              </div>
            </div>

            {/* Improved Resume Column */}
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#059669',
                borderRadius: '8px 8px 0 0',
                borderBottom: '1px solid rgba(16, 185, 129, 0.2)'
              }}>
                <CheckCircle size={20} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Improved Resume</h3>
              </div>
              <div style={{
                background: '#f9fafb',
                padding: '1.5rem',
                borderRadius: '0 0 8px 8px',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                maxHeight: '600px',
                overflowY: 'auto'
              }}>
                {renderImprovedWithDiff()}
              </div>
            </div>
          </div>
        )}

        {/* Original View Only */}
        {currentView === 'original' && (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{
              background: '#f9fafb',
              padding: '1.5rem',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              maxHeight: '600px',
              overflowY: 'auto'
            }}>
              {fileUrl && fileType === 'application/pdf' ? (
                <iframe
                  src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=1`}
                  style={{
                    width: '100%',
                    height: '550px',
                    border: 'none',
                    display: 'block',
                    borderRadius: '6px'
                  }}
                  title="Original Resume PDF"
                />
              ) : (
                formatResumeText(analysisData.original.resume_text, analysisData.original.sections_structure, false, analysisData?.extracted_links || [])
              )}
            </div>
          </div>
        )}

        {/* Improved View Only */}
        {currentView === 'improved' && (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{
              background: '#f9fafb',
              padding: '1.5rem',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              maxHeight: '600px',
              overflowY: 'auto'
            }}>
              {formatResumeText(analysisData.improved.resume_text, analysisData.improved.sections_structure, true, analysisData?.extracted_links || [])}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ResumeAnalyzer = () => {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileType, setFileType] = useState(null);
  const [error, setError] = useState('');
  const [analysisData, setAnalysisData] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [completedSteps, setCompletedSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(null);
  const [currentFactIndex, setCurrentFactIndex] = useState(0);
  const fileInputRef = useRef(null);
  
  // LinkedIn URL state
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [linkedinUploading, setLinkedinUploading] = useState(false);
  const [linkedinUploadProgress, setLinkedinUploadProgress] = useState(0);
  const [linkedinUploadSuccess, setLinkedinUploadSuccess] = useState(false);

  // Array of "Did you know?" facts for stages 2 and 3
  const didYouKnowFacts = [
    "Resumes with a professional summary are 70% more likely to be read by recruiters than those without.",
    "Recruiters spend an average of just 7 seconds scanning a resume. Our AI helps you make every second count.",
    "Using industry-specific keywords can increase your resume's ATS pass rate by up to 40%.",
    "Resumes with quantified achievements (numbers, percentages) are 2x more likely to get interviews.",
    "Tailoring your resume to each job can increase your chances of getting an interview by 60%."
  ];

  // Load Material Symbols and Sora fonts for skeleton animation
  useEffect(() => {
    // Check if fonts are already loaded
    const existingSora = document.querySelector('link[href*="Sora"]');
    const existingMaterial = document.querySelector('link[href*="Material+Symbols"]');
    
    let soraLink, materialLink;
    
    if (!existingSora) {
      soraLink = document.createElement('link');
      soraLink.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap';
      soraLink.rel = 'stylesheet';
      document.head.appendChild(soraLink);
    }
    
    if (!existingMaterial) {
      materialLink = document.createElement('link');
      materialLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@400&display=swap';
      materialLink.rel = 'stylesheet';
      document.head.appendChild(materialLink);
    }
    
    return () => {
      if (soraLink && soraLink.parentNode) {
        soraLink.parentNode.removeChild(soraLink);
      }
      if (materialLink && materialLink.parentNode) {
        materialLink.parentNode.removeChild(materialLink);
      }
    };
  }, []);

  // Cycle through "Did you know?" facts during stages 2 and 3 only
  useEffect(() => {
    if (step === 'analyzing' && (currentStep === 1 || currentStep === 2)) {
      const interval = setInterval(() => {
        setCurrentFactIndex((prevIndex) => (prevIndex + 1) % didYouKnowFacts.length);
      }, 8000); // Change fact every 8 seconds

      return () => clearInterval(interval);
    } else {
      // Reset to first fact when not in stages 2 or 3
      setCurrentFactIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, currentStep]); // didYouKnowFacts is a constant array, no need to include in deps

  const triggerFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!validTypes.includes(uploadedFile.type)) {
      setError('Please upload PDF, DOCX, or TXT files only');
      return;
    }
    
    if (uploadedFile.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }
    
    // Create object URL for displaying the original file
    const url = URL.createObjectURL(uploadedFile);
    setFile(uploadedFile);
    setFileUrl(url);
    setFileType(uploadedFile.type);
    setError('');
  };

  const analyzeResume = async () => {
    if (!file) {
      setError('Please upload a resume first');
      return;
    }

    setStep('analyzing');
    setError('');
    setCompletedSteps([]);
    setCurrentStep(0);

    try {
      // Step 1: Extract text from the uploaded file
      setCurrentStep(0);
      const formData = new FormData();
      formData.append('file', file);

      const extractResponse = await fetch(`${config.apiUrl}/api/extract-text`, {
        method: 'POST',
        body: formData
      });

      if (!extractResponse.ok) {
        const errorData = await extractResponse.json();
        throw new Error(errorData.error || 'Failed to extract text from resume');
      }

      const extractData = await extractResponse.json();
      const resumeText = extractData.text;
      const extractedLinks = extractData.links || []; // Store extracted links from PDF

      if (!resumeText || resumeText.length < 50) {
        throw new Error('Could not extract sufficient text from the resume');
      }

      // Step 0: Extract text - mark as complete immediately after extraction
      setCompletedSteps([0]);
      setCurrentStep(1);

      // Step 1: Analyze the resume (LLM Call #1: Analyzing job relevance)
      // This API call will take time - UI shows step 1 as "current" during this call
      const analyzeResponse = await fetch(`${config.apiUrl}/api/analyze-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: resumeText })
      });

      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json();
        throw new Error(errorData.error || 'Failed to analyze resume');
      }

      // API Call #1 complete - update UI immediately
      const analysisResult = await analyzeResponse.json();
      setCompletedSteps([0, 1]); // Mark step 1 complete
      setCurrentStep(2); // Move to step 2

      // Step 2: Generate improved resume (LLM Call #2: Generating improved resume)
      // This API call will take time - UI shows step 2 as "current" during this call
      
      // Prepare resume data object with both text and links from extract-text API response
      const resumeData = {
        text: resumeText,
        links: extractedLinks
      };
      
      const generateResponse = await fetch(`${config.apiUrl}/api/generate-improved-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          resume_data: resumeData, // Send full resume data object with both text and links
          full_analysis: analysisResult.full_analysis
        })
      });

      if (!generateResponse.ok) {
        const errorData = await generateResponse.json();
        throw new Error(errorData.error || 'Failed to generate improved resume');
      }

      // API Call #2 complete - update UI immediately
      const analysisData = await generateResponse.json();
      
      // Add extracted links to analysisData for use in header parsing
      analysisData.extracted_links = extractedLinks;
      
      setCompletedSteps([0, 1, 2]); // Mark step 2 complete
      // Keep currentStep as 2 to show stage 3 until we transition
      
      // Brief delay to show completion before transitioning to results
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setAnalysisData(analysisData);
      setStep('results');
      setCurrentStep(null); // Clear currentStep only after transitioning to results
    } catch (err) {
      console.error('Analysis error:', err);
      setError(err.message || 'Resume analysis failed. Please try again.');
      setStep('upload');
      setCompletedSteps([]);
      setCurrentStep(null);
    }
  };

  const downloadImprovedResume = () => {
    if (!analysisData) return;
    
    // Generate ATS-friendly PDF (clean, professional, no fancy formatting)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15; // Reduced margin from 20 to 15mm
    const contentWidth = pageWidth - (margin * 2);
    let yPosition = margin;
    
    // Get extracted links for header parsing
    const extractedLinks = analysisData?.extracted_links || [];
    
    // Helper function to add text with word wrap
    const addText = (text, x, y, options = {}) => {
      const {
        fontSize = 10,
        fontStyle = 'normal',
        color = [0, 0, 0],
        maxWidth = contentWidth,
        align = 'left'
      } = options;
      
      pdf.setFontSize(fontSize);
      pdf.setTextColor(...color);
      pdf.setFont('helvetica', fontStyle);
      
      const lines = pdf.splitTextToSize(text, maxWidth);
      pdf.text(lines, x, y, { align });
      
      return lines.length * (fontSize * 0.35); // Further reduced from 0.35 to 0.32
    };
    
    // Parse resume sections
    const sections = parseResumeSectionsSimple(
      analysisData.improved.resume_text,
      analysisData.improved.sections_structure
    );
    
    const sectionsWithContent = sections.filter(section => {
      const content = section.content || '';
      return content.trim().length > 0;
    });
    
    let previousWasHeader = false;
    
    sectionsWithContent.forEach((section, idx) => {
      // Check if we need a new page
      if (yPosition > pageHeight - 20) {
        pdf.addPage();
        yPosition = margin;
      }
      
      const isHeaderSection = section.type === 'header';
      
      if (isHeaderSection) {
        // Use the same header parsing logic as the improved resume view
        const headerData = parseHeaderContent(section.content, extractedLinks);
        
        if (headerData) {
          // Name - Bold and Prominent (centered)
          if (headerData.name) {
            const nameHeight = addText(headerData.name, pageWidth / 2, yPosition, {
              fontSize: 16,
              fontStyle: 'bold',
              color: [0, 0, 0],
              maxWidth: contentWidth,
              align: 'center'
            });
            yPosition += nameHeight + 0.5; // Reduced from 2
          }
          
          // Location - First Line (centered)
          if (headerData.location) {
            const locationHeight = addText(headerData.location, pageWidth / 2, yPosition, {
              fontSize: 10,
              fontStyle: 'normal',
              color: [0, 0, 0],
              maxWidth: contentWidth,
              align: 'center'
            });
            yPosition += locationHeight + 2; // Reduced from 1.5
          }
          
          // Contact Info - Second Line (Phone | Email | LinkedIn) (centered, LinkedIn clickable)
          const contactSegments = [];
          if (headerData.phone) {
            contactSegments.push({ text: headerData.phone, link: null });
          }
          if (headerData.email) {
            contactSegments.push({ text: headerData.email, link: null });
          }
          if (headerData.linkedin) {
            contactSegments.push({ text: 'LinkedIn', link: headerData.linkedin });
          }
          
          if (contactSegments.length > 0) {
            const separator = ' | ';
            const separatorWidth = pdf.getTextWidth(separator);
            const segmentWidths = contactSegments.map(seg => pdf.getTextWidth(seg.text));
            const totalWidth = segmentWidths.reduce((sum, w) => sum + w, 0) + separatorWidth * (contactSegments.length - 1);
            const startX = (pageWidth - totalWidth) / 2;
            
            let currentX = startX;
            const contactFontSize = 10;
            pdf.setFontSize(contactFontSize);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(0, 0, 0);
            
            contactSegments.forEach((seg, idx) => {
              const segWidth = segmentWidths[idx];
              if (seg.link) {
                pdf.textWithLink(seg.text, currentX, yPosition, { url: seg.link });
              } else {
                pdf.text(seg.text, currentX, yPosition);
              }
              currentX += segWidth;
              
              if (idx < contactSegments.length - 1) {
                pdf.text(separator, currentX, yPosition);
                currentX += separatorWidth;
              }
            });
            
            const lineHeight = contactFontSize * 0.35;
            yPosition += lineHeight + 1; // Reduced from 1.5
          }
          
          // Other links (GitHub, Kaggle, Portfolio) if any
          const otherLinkParts = [];
          if (headerData.github) {
            otherLinkParts.push('GitHub');
          }
          if (headerData.kaggle) {
            otherLinkParts.push('Kaggle');
          }
          if (headerData.portfolio) {
            otherLinkParts.push('Portfolio');
          }
          
          if (otherLinkParts.length > 0) {
            const otherLinksLine = otherLinkParts.join(' | ');
            const otherLinksHeight = addText(otherLinksLine, pageWidth / 2, yPosition, {
              fontSize: 10,
              fontStyle: 'normal',
              color: [0, 0, 0],
              maxWidth: contentWidth,
              align: 'center'
            });
            yPosition += otherLinksHeight + 1;
          }
          
          // Other info if any
          if (headerData.other && headerData.other.length > 0) {
            headerData.other.forEach((item) => {
              const otherHeight = addText(item, pageWidth / 2, yPosition, {
                fontSize: 9.5,
                fontStyle: 'normal',
                color: [0, 0, 0],
                maxWidth: contentWidth,
                align: 'center'
              });
              yPosition += otherHeight + 0.5;
            });
          }
        } else {
          // Fallback to original parsing if parseHeaderContent fails
          const headerLines = section.content
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
          
          headerLines.forEach((line, lineIdx) => {
            const sanitizedLine = line.replace(/\*\*(.*?)\*\*/g, '$1');
            const addedHeight = addText(sanitizedLine, pageWidth / 2, yPosition, {
              fontSize: lineIdx === 0 ? 18 : 10,
              fontStyle: lineIdx === 0 ? 'bold' : 'normal',
              maxWidth: contentWidth,
              align: 'center'
            });
            yPosition += addedHeight + (lineIdx === 0 ? 1.5 : 1);
          });
        }
        
        yPosition += 0.2; // Reduced from 3
        previousWasHeader = true;
        return;
      }
      
      // Section Title (bold, uppercase, black text - ATS friendly)
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0, 0, 0);
      yPosition += previousWasHeader ? 1 : 2; // Reduced from 2/3
      pdf.text(section.name.toUpperCase(), margin, yPosition);
      
      // Simple underline for section header (thin line)
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.1);
      yPosition += 1.5; // Reduced from 1.5
      pdf.line(margin, yPosition, margin + contentWidth, yPosition);
      yPosition += 4; // Reduced from 3
      
      // Section Content Area
      const contentStartX = margin;
      const contentWidthInner = contentWidth;
      let contentY = yPosition;
      
      // Parse and add content
      const contentLines = section.content.split('\n');
      
      contentLines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          contentY += 0.8; // Reduced from 1
          return;
        }
        
        // Check for new page
        if (contentY > pageHeight - 20) {
          pdf.addPage();
          contentY = margin + 8;
        }
        
        // Detect content type
        const isBullet = /^[•·\-*]/.test(trimmed) || /^\d+\./.test(trimmed);
        const isJobHeader = /^.+ \| .+$/.test(trimmed) && section.type === 'experience';
        const isDateLine = /^\d{4}|\w+ \d{4}|Present|Current/i.test(trimmed) && section.type === 'experience';
        const isDegreeLine = /\b(B\.Tech|B\.E\.|B\.Sc\.|M\.Tech|M\.B\.A|Degree)\b/i.test(trimmed) && section.type === 'education';
        const isNameLine = section.type === 'header' && !trimmed.includes('|') && !trimmed.includes('@') && trimmed.length < 50 && trimmed.split(' ').length <= 4;
        const isTechnologiesLine = section.type === 'projects' && /^Technologies:\s*/i.test(trimmed);
        const isTechniquesLine = section.type === 'projects' && /^Techniques:\s*/i.test(trimmed);
        
        // Check for project title
        const isProjectTitle = section.type === 'projects' && 
                               !isBullet && 
                               !isTechnologiesLine &&
                               !isTechniquesLine &&
                               (trimmed.includes('[') || 
                                (trimmed.length > 10 && trimmed.length < 100 && 
                                 !trimmed.includes(':') && 
                                 !trimmed.match(/^\d+[.)]/)));
        
        // Remove [CN Project] text from display but note it for logo
        const hasCNProject = trimmed.includes('[CN Project]');
        const cleanedLine = trimmed.replace(/\[CN Project\]/g, '').trim();
        
        if (isNameLine) {
          contentY += addText(trimmed, contentStartX, contentY, {
            fontSize: 12,
            fontStyle: 'bold',
            color: [0, 0, 0],
            maxWidth: contentWidthInner
          });
          contentY += 1.2;
        } else if (isJobHeader) {
          contentY += addText(trimmed, contentStartX, contentY, {
            fontSize: 10,
            fontStyle: 'bold',
            color: [0, 0, 0],
            maxWidth: contentWidthInner
          });
          contentY += 1.5; // Minimal space after job header
        } else if (isDateLine) {
          contentY += addText(trimmed, contentStartX, contentY, {
            fontSize: 9,
            fontStyle: 'normal',
            color: [0, 0, 0],
            maxWidth: contentWidthInner
          });
          contentY += 1.2; // Reduced from 1.5
        } else if (isDegreeLine) {
          contentY += addText(trimmed, contentStartX, contentY, {
            fontSize: 10,
            fontStyle: 'bold',
            color: [0, 0, 0],
            maxWidth: contentWidthInner
          });
          contentY += 0.3; // Minimal space after degree
        } else if (isProjectTitle) {
          // Project title with optional CN logo
          const titleHeight = addText(cleanedLine, contentStartX, contentY, {
            fontSize: 10,
            fontStyle: 'bold',
            color: [0, 0, 0],
            maxWidth: hasCNProject ? contentWidthInner - 8 : contentWidthInner
          });
          
          // Add CN logo if this project has [CN Project] marker
          if (hasCNProject) {
            try {
              const logoSize = 3;
              const logoX = contentStartX + contentWidthInner - logoSize;
              const logoY = contentY - 2;
              
              pdf.setFontSize(7);
              pdf.setFont('helvetica', 'bold');
              pdf.setTextColor(255, 255, 255);
              pdf.setFillColor(255, 100, 0);
              pdf.roundedRect(logoX - 1, logoY, 4, 2.5, 0.5, 0.5, 'F');
              pdf.text('CN', logoX, logoY + 2);
              pdf.setTextColor(0, 0, 0);
            } catch (e) {
              console.error('Error adding CN badge:', e);
            }
          }
          
          contentY += titleHeight + 1; // Reduced from 1
        } else if (isTechnologiesLine) {
          const techContent = trimmed.replace(/^Technologies:\s*/i, '');
          const labelPadding = 2;
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(0, 0, 0);
          pdf.text('Technologies:', contentStartX, contentY);
          pdf.setFont('helvetica', 'normal');
          const techWidth = pdf.getTextWidth('Technologies: ');
          const contentStart = contentStartX + techWidth + labelPadding;
          const remainingWidth = contentWidthInner - (techWidth + labelPadding);
          contentY += addText(techContent, contentStart, contentY, {
            fontSize: 10,
            color: [0, 0, 0],
            maxWidth: remainingWidth
          });
          contentY += 1; // Reduced from 1
        } else if (isTechniquesLine) {
          const techContent = trimmed.replace(/^Techniques:\s*/i, '');
          const labelPadding = 1.5;
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(0, 0, 0);
          pdf.text('Techniques:', contentStartX, contentY);
          pdf.setFont('helvetica', 'normal');
          const techWidth = pdf.getTextWidth('Techniques: ');
          const contentStart = contentStartX + techWidth + labelPadding;
          const remainingWidth = contentWidthInner - (techWidth + labelPadding);
          contentY += addText(techContent, contentStart, contentY, {
            fontSize: 10,
            color: [0, 0, 0],
            maxWidth: remainingWidth
          });
          contentY += 1; // Space after techniques
        } else if (isBullet) {
          // Bullet points
          const bulletText = trimmed.replace(/^[•·\-*\d+.]\s*/, '');
          pdf.setFontSize(10);
          pdf.setTextColor(0, 0, 0);
          pdf.setFont('helvetica', 'normal');
          pdf.text('-', contentStartX, contentY);
          contentY += addText(bulletText, contentStartX + 4, contentY, {
            fontSize: 10,
            color: [0, 0, 0],
            maxWidth: contentWidthInner - 4
          });
          contentY += 0.8; // Reduced from 0.8
        } else {
          // Regular text
          contentY += addText(cleanedLine, contentStartX, contentY, {
            fontSize: 10,
            color: [0, 0, 0],
            maxWidth: contentWidthInner
          });
          contentY += 0.8; // Reduced from 1
        }
      });
      
      yPosition = contentY + 0.8; // Reduced from 2.5
      previousWasHeader = false;
    });
    
    // Save PDF
    pdf.save('improved_resume_coding_ninjas.pdf');
  };

  const startOver = () => {
    // Clean up file URL to prevent memory leaks
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
    }
    setStep('upload');
    setFile(null);
    setFileUrl(null);
    setFileType(null);
    setAnalysisData(null);
    setError('');
    setCompletedSteps([]);
    setCurrentStep(null);
  };

  // Cleanup file URL on unmount
  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  // Learning Journey Chart Component
  const LearningJourneyChart = ({ learningComparison }) => {
    const [chartData, setChartData] = useState(null);
    const chartRef = useRef(null);

    useEffect(() => {
      if (!learningComparison) return;

      const conventionalData = learningComparison.conventional_learning.timeline;
      const cnData = learningComparison.cn_course_learning.timeline;

      const labels = conventionalData.map(point => `Month ${point.month}`);
      const conventionalProgress = conventionalData.map(point => point.progress);
      const cnProgress = cnData.map(point => point.progress);

      const data = {
        labels: labels,
        datasets: [
          {
            label: 'Conventional Learning',
            data: conventionalProgress,
            borderColor: '#9ca3af',
            backgroundColor: 'rgba(156, 163, 175, 0.1)',
            borderWidth: 3,
            borderDash: [8, 4],
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: '#9ca3af',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: false,
            tension: 0.4, // Smooth curves
            animation: {
              duration: 2000,
              easing: 'easeOutQuart'
            }
          },
          {
            label: 'Coding Ninjas Course',
            data: cnProgress,
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            borderWidth: 4,
            pointRadius: 7,
            pointHoverRadius: 10,
            pointBackgroundColor: '#667eea',
            pointBorderColor: '#fff',
            pointBorderWidth: 3,
            fill: true,
            tension: 0.4, // Smooth curves
            animation: {
              duration: 2000,
              delay: 500,
              easing: 'easeOutQuart'
            }
          }
        ]
      };

      setChartData(data);
    }, [learningComparison]);

    if (!chartData) return <div>Loading chart...</div>;

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: {
              size: 14,
              weight: 600,
              family: 'system-ui, -apple-system, sans-serif'
            },
            color: '#374151'
          }
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: {
            size: 14,
            weight: 600
          },
          bodyFont: {
            size: 13
          },
          displayColors: true,
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.parsed.y}% Job-Ready`;
            },
            title: function(context) {
              return context[0].label;
            }
          }
        },
        title: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            stepSize: 25,
            font: {
              size: 12,
              family: 'system-ui, -apple-system, sans-serif'
            },
            color: '#6b7280',
            callback: function(value) {
              return value + '%';
            }
          },
          grid: {
            color: '#e5e7eb',
            lineWidth: 1
          },
          title: {
            display: true,
            text: 'Job-Ready Percentage',
            font: {
              size: 14,
              weight: 600,
              family: 'system-ui, -apple-system, sans-serif'
            },
            color: '#374151',
            padding: { top: 10, bottom: 10 }
          }
        },
        x: {
          ticks: {
            font: {
              size: 12,
              family: 'system-ui, -apple-system, sans-serif'
            },
            color: '#6b7280'
          },
          grid: {
            display: false
          },
          title: {
            display: true,
            text: 'Timeline (Months)',
            font: {
              size: 14,
              weight: 600,
              family: 'system-ui, -apple-system, sans-serif'
            },
            color: '#374151',
            padding: { top: 10, bottom: 10 }
          }
        }
      },
      animation: {
        duration: 2000,
        easing: 'easeOutQuart',
        delay: (context) => {
          return context.dataIndex * 100;
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      elements: {
        point: {
          hoverRadius: 10,
          hoverBorderWidth: 3
        }
      }
    };

    // Find when CN course reaches 100%
    const cn100Month = learningComparison.cn_course_learning.timeline.find(p => p.progress >= 100)?.month || 8;
    const conventionalFinal = learningComparison.conventional_learning.timeline[learningComparison.conventional_learning.timeline.length - 1]?.progress || 85;

    return (
      <div style={{ height: '100%', position: 'relative' }}>
        <Line ref={chartRef} data={chartData} options={options} />
        {/* Key Insights Box */}
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '1rem',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          border: '2px solid #667eea',
          minWidth: '200px',
          zIndex: 10
        }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#667eea', marginBottom: '0.5rem' }}>Key Insight</div>
          <div style={{ fontSize: '0.875rem', color: '#374151', lineHeight: '1.5' }}>
            <strong style={{ color: '#667eea' }}>100% Job-Ready</strong> in just{' '}
            <strong style={{ color: '#667eea' }}>{cn100Month} months</strong> vs{' '}
            <strong style={{ color: '#9ca3af' }}>{conventionalFinal}%</strong> in 12 months
          </div>
        </div>
      </div>
    );
  };

  // Resume parsing function (used by both display and PDF generation)
  const parseResumeSectionsSimple = (text, sectionsInfo = null) => {
    if (!text) return [];
    
    const lines = text.split('\n');
    const sections = [];
    let currentSection = null;
    let currentContent = [];
    let headerLines = [];
    let headerCaptured = false;
    
    const sectionPatterns = {
      header: /^(HEADER|CONTACT INFORMATION|CONTACT|NAME|PERSONAL DETAILS)$/i,
      summary: /^(PROFESSIONAL SUMMARY|SUMMARY|OBJECTIVE|CAREER OBJECTIVE|PROFILE|ABOUT)$/i,
      skills: /^(TECHNICAL SKILLS|SKILLS|CORE COMPETENCIES|KEY SKILLS|COMPETENCIES|TECHNICAL COMPETENCIES)$/i,
      experience: /^(PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EMPLOYMENT HISTORY|CAREER HISTORY|WORK HISTORY)$/i,
      education: /^(EDUCATION|ACADEMIC BACKGROUND|ACADEMIC QUALIFICATIONS|QUALIFICATIONS)$/i,
      projects: /^(PROJECTS|KEY PROJECTS|PORTFOLIO PROJECTS|SELECTED PROJECTS|PROJECT EXPERIENCE)$/i,
      certifications: /^(CERTIFICATIONS|CERTIFICATES|PROFESSIONAL CERTIFICATIONS)$/i,
      awards: /^(AWARDS|ACHIEVEMENTS|HONORS|RECOGNITIONS)$/i,
      languages: /^(LANGUAGES|LANGUAGE PROFICIENCY)$/i,
      other: /^[A-Z][A-Z\s&/]+$/
    };
    
    const detectSectionType = (line) => {
      for (const [type, pattern] of Object.entries(sectionPatterns)) {
        if (pattern.test(line.trim())) {
          return type === 'other' ? 'other' : type;
        }
      }
      return null;
    };
    
    lines.forEach((line) => {
      const trimmed = line.trim();
      const sectionType = detectSectionType(trimmed);
      
      if (sectionType) {
        if (!headerCaptured && headerLines.length > 0) {
          sections.push({
            name: 'HEADER',
            type: 'header',
            isNew: sectionsInfo?.sections?.some(
              (s) => s.section_name?.toLowerCase() === 'header'
            ) || false,
            content: headerLines.join('\n').trim()
          });
          headerCaptured = true;
          headerLines = [];
        }
        
        if (currentSection) {
          sections.push({
            ...currentSection,
            content: currentContent.join('\n').trim()
          });
        }
        currentSection = {
          name: trimmed,
          type: sectionType,
          isNew: sectionsInfo?.new_sections_added?.includes(trimmed) || false
        };
        currentContent = [];
      } else if (trimmed) {
        if (!currentSection && !headerCaptured) {
          headerLines.push(line);
        } else {
          currentContent.push(line);
        }
      } else if (currentContent.length > 0) {
        currentContent.push('');
      }
    });
    
    if (!headerCaptured && headerLines.length > 0) {
      sections.push({
        name: 'HEADER',
        type: 'header',
        isNew: sectionsInfo?.sections?.some(
          (s) => s.section_name?.toLowerCase() === 'header'
        ) || false,
        content: headerLines.join('\n').trim()
      });
      headerCaptured = true;
    }
    
    if (currentSection) {
      sections.push({
        ...currentSection,
        content: currentContent.join('\n').trim()
      });
    }
    
    return sections.length > 0 ? sections : [{
      name: 'RESUME CONTENT',
      type: 'other',
      content: text,
      isNew: false
    }];
  };

// --- VIEW: UPLOAD (MATCHING FIGMA DESIGN EXACTLY) ---
if (step === 'upload') {
  // Colors matching Figma design system - Orange primary, White/Light Gray backgrounds
  const colors = {
    primaryOrange: '#FF6B35', // Orange for buttons, CTAs, step indicator
    successGreen: '#10B981', // Success green
    bgLight: '#FFFFFF', // White background
    bgGray: '#F9FAFB', // Light gray background
    textDark: '#111827', // Dark text for headings
    textLight: '#6B7280', // Light gray text for secondary content
    textBlue: '#2563EB', // Blue for links
    errorRed: '#EF4444', // Error red
    borderGray: '#E5E7EB', // Border gray
  };

  // Handle LinkedIn URL submission
  const handleLinkedInSubmit = async () => {
    if (!linkedinUrl.trim()) {
      setError('Please enter a LinkedIn profile URL');
      return;
    }

    // Validate LinkedIn URL format
    const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;
    if (!linkedinPattern.test(linkedinUrl.trim())) {
      setError('Please enter a valid LinkedIn profile URL (e.g., https://linkedin.com/in/john-doe)');
      return;
    }

    setLinkedinUploading(true);
    setLinkedinUploadProgress(0);
    setError('');
    setLinkedinUploadSuccess(false);

    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setLinkedinUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          setLinkedinUploading(false);
          setLinkedinUploadSuccess(true);
          // Note: LinkedIn URL extraction would need backend support
          // For now, this is UI-only to match Figma design
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#FFFFFF', 
      fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: colors.textDark,
      overflowX: 'hidden',
      paddingBottom: '1rem'
    }}>
      {/* Inject Styles for animations and specific fonts */}
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          style={{ display: 'none' }} 
        accept=".pdf,.doc,.docx,.txt,.rtf" 
        />

      <div style={{ maxWidth: '100%', backgroundColor: '#FEF4F1', padding: '3rem',marginBottom: '1rem' }}>
        {/* Title with Icon */}
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <h1 style={{ 
            fontSize: '2rem', 
            fontWeight: 700, 
            color: '#171A1F', 
            lineHeight: 1.2,
            margin: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontFamily: "Archivo"
          }}>
            Check Your Job Match Score with AI
            <img src="https://cdn-icons-png.flaticon.com/512/3439/3439707.png" alt="logo" style={{ width: '28px', height: '28px' }} />
          </h1>
            </div>

        {/* Subtitle - Reference Section */}
        <div style={{
          width: '100%',
          backgroundColor: '#FEF4F1',
          display: 'flex',
          alignItems: 'center',
          flexDirection: 'column',
          
        }}>
          <p style={{ 
            textAlign: 'center',
            fontSize: '0.875rem',
            color: '#6B7280', 
            lineHeight: 1.6,
            maxWidth: '700px',
            letterSpacing:'0.01rem',
            marginLeft: 'auto',
            marginRight: 'auto',
            fontWeight: 400,
            fontFamily: "Inter",
            margin: 0
          }}>
            Upload your resume to see how job-ready you are for a Data Science career. We'll analyze your resume and analyse the gaps based on 10000+ Data Analytics job postings
          </p>
        </div>
         </div>
        {/* Step Indicator */}
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 1.5rem' }}>
        <div style={{ 
                display: 'flex',
          flexDirection: 'column', 
                alignItems: 'center',
                gap: '0.5rem',
                marginRight: '80px',
          marginBottom: '2rem'
        }}>
          <span style={{ 
            fontSize: '0.875rem', 
            fontWeight: 600, 
            color: colors.primaryOrange 
          }}>
            Step 1 of 2
          </span>
          {/* Progress Bar - Two circles style */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            width: '200px',
            justifyContent: 'center'
          }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: '#FF6B35',
              border: '2px solid #FF6B35'
            }} />
            <div style={{
              flex: 1,
              height: '2px',
              backgroundColor: '#FF6B35'
            }} />
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              border: '2px solid #E5E7EB'
            }} />
          </div>
        </div>

        {/* File Upload Zone */}
        <div style={{ marginBottom: '2rem' }}>
          {!file ? (
            <div style={{
              border: '0.5px solid #DEE1E6',
              borderRadius: '0.5rem',
              padding: '3rem 2rem',
              textAlign: 'center',
              cursor: 'pointer',
              maxWidth: '460px',
              marginLeft: '100px',
              marginBottom: '2rem',
              backgroundColor: '#FFFFFF',
              transition: 'all 0.3s ease'
            }}>
            <div
              onClick={triggerFileUpload}
              onDragOver={(e) => { 
                e.preventDefault(); 
                e.currentTarget.style.borderColor = '#FF6B35'; 
                e.currentTarget.style.backgroundColor = '#F9FAFB';
              }}
              onDragLeave={(e) => { 
                e.currentTarget.style.borderColor = '#E5E7EB'; 
                e.currentTarget.style.backgroundColor = '#FFFFFF';
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = '#E5E7EB';
                e.currentTarget.style.backgroundColor = '#FFFFFF';
                const droppedFile = e.dataTransfer.files[0];
                if (droppedFile) {
                  const event = { target: { files: [droppedFile] } };
                  handleFileUpload(event);
                }
              }}
              style={{
                border: '2px dashed #E5E7EB',
                borderRadius: '0.5rem',
                padding: '1rem 0rem',
                textAlign: 'center',
                cursor: 'pointer',
                maxWidth: '400px',
                backgroundColor: '#FFFFFF',
                transition: 'all 0.3s ease'
              }}
            >
              <UploadCloud size={64} style={{ color: '#6B7280', marginBottom: '1rem' }} />
              <p style={{ 
                fontSize: '1rem', 
                fontWeight: 600, 
                color: '#111827', 
                marginBottom: '0.5rem',
                margin: '0 0 0.5rem 0',
                fontFamily: "Archivo"
              }}>
                Upload your resume
              </p>
              <p 
                style={{ 
                  fontSize: '0.75rem', 
                  color: '#565D6D', 
                  textDecoration: 'none',
                  marginBottom: '1rem',
                  cursor: 'pointer',
                  margin: '0 0 1rem 0',
                  fontFamily: "Inter"
                }}
                onClick={(e) => { e.stopPropagation(); triggerFileUpload(); }}
              >
                Supported formats: PDF, DOC, DOCX (Max 5MB)
              </p>
                <button 
                onClick={(e) => { e.stopPropagation(); triggerFileUpload(); }}
                  style={{ 
                  backgroundColor: '#ffffff',
                  border: '1px solid #E5E7EB',
                  borderRadius: '0.375rem',
                  padding: '0.6rem 3.5rem',
                  color: '#111827',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                    cursor: 'pointer',
                  transition: 'all 0.2s',
                  marginTop: '0.5rem',
                  fontFamily: "Inter"
                  }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#F3F4F6';
                  e.currentTarget.style.borderColor = '#9CA3AF';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#F9FAFB';
                  e.currentTarget.style.borderColor = '#E5E7EB';
                }}
                >
                Choose File
                </button>
            </div>
            </div>
              ) : (
            <div style={{
              border: '2px solid #10B981',
                    borderRadius: '0.5rem', 
              padding: '1rem 1.5rem',
              backgroundColor: '#F0FDF4',
              display: 'flex',
                    alignItems: 'center', 
              justifyContent: 'space-between',
              gap: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                <CheckCircle size={24} style={{ color: '#10B981', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ 
                    fontSize: '0.875rem', 
                    fontWeight: 600, 
                    color: '#111827', 
                    margin: 0, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                    fontFamily: "'Space Grotesk', sans-serif"
                  }}>
                    {file.name}
                  </p>
                  <p style={{ 
                    fontSize: '0.75rem', 
                    color: '#6B7280', 
                    margin: '0.25rem 0 0',
                    fontFamily: "'Space Grotesk', sans-serif"
                  }}>
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setFile(null); 
                  setFileUrl(null); 
                  setLinkedinUrl('');
                  setLinkedinUploadSuccess(false);
                }}
                style={{
                  background: 'transparent',
                    border: 'none',
                  color: '#6B7280',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  display: 'flex',
                  alignItems: 'center'
                }}
                >
                <XCircle size={20} />
                </button>
              </div>
            )}
          </div>

        {/* LinkedIn Profile Input (Optional) */}
        <div style={{ marginBottom: '2rem', marginLeft: '60px' }} >
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            marginBottom: '0.75rem' 
          }}>
            <Lightbulb size={18} style={{ color: '#6B7280' }} />
            <p style={{ 
              fontSize: '0.875rem', 
              color: '#111827', 
              margin: 0,
              fontWeight: 500,
              fontFamily: "Inter"
            }}>
              Don't have your resume handy? Paste your LinkedIn profile URL instead.
            </p>
                </div>

          <div style={{ position: 'relative' }}>
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                border: '1px solid #E5E7EB',
                borderRadius: '0.5rem',
                padding: '0.75rem 1rem',
                backgroundColor: '#FFFFFF',
                gap: '0.75rem',
                maxWidth: '525px',
              }}>
                <LinkIcon size={20} style={{ color: '#6B7280', flexShrink: 0 }} />
                <input
                  type="text"
                  value={linkedinUrl}
                  onChange={(e) => {
                    setLinkedinUrl(e.target.value);
                    setLinkedinUploadSuccess(false);
                  }}
                  placeholder="e.g., https://linkedin.com/in/john-doe"
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    fontSize: '0.875rem',
                    color: '#111827',
                    backgroundColor: 'transparent',
                    fontFamily: "'Space Grotesk', sans-serif"
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !linkedinUploading) {
                      handleLinkedInSubmit();
                    }
                  }}
                />
                <Info size={18} style={{ color: '#6B7280', flexShrink: 0, cursor: 'help' }} />
            </div>

            {/* Upload Progress Bar */}
            {linkedinUploading && (
              <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ 
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.25rem'
                  }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#FF6B35', fontFamily: "'Space Grotesk', sans-serif" }}>
                      {linkedinUploadProgress}%
                    </span>
                  </div>
            <div style={{ 
                    width: '100%',
                    height: '6px',
                    backgroundColor: '#E5E7EB',
                    borderRadius: '3px',
                    overflow: 'hidden'
            }}>
                <div style={{ 
                      width: `${linkedinUploadProgress}%`,
                      height: '100%',
                      backgroundColor: '#FF6B35',
                      borderRadius: '3px',
                      transition: 'width 0.2s ease'
                    }} />
                  </div>
                  <p style={{ 
                    fontSize: '0.75rem', 
                    color: '#6B7280', 
                    margin: '0.25rem 0 0',
                    textAlign: 'center',
                    fontFamily: "'Space Grotesk', sans-serif"
                  }}>
                    uploading....
                  </p>
                </div>
            )}

            {/* Upload Success Notification */}
            {linkedinUploadSuccess && (
                    <div style={{ 
                marginTop: '0.75rem',
                padding: '0.75rem 1rem',
                backgroundColor: '#F0FDF4',
                border: '1px solid #10B981',
                borderRadius: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                animation: 'fadeIn 0.3s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#10B981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                    }}>
                    <CheckCircle size={18} style={{ color: '#FFFFFF' }} />
                    </div>
                    <div>
                    <p style={{ 
                      fontSize: '0.875rem', 
                      fontWeight: 600, 
                      color: '#111827', 
                      margin: 0,
                      fontFamily: "'Space Grotesk', sans-serif"
                    }}>
                      Upload Success
                    </p>
                    <p style={{ 
                      fontSize: '0.75rem', 
                      color: '#6B7280', 
                      margin: '0.25rem 0 0',
                      fontFamily: "'Space Grotesk', sans-serif"
                    }}>
                      Your resume is uploaded
                    </p>
                    </div>
                  </div>
                <button
                  onClick={() => setLinkedinUploadSuccess(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#6B7280',
                    cursor: 'pointer',
                    padding: '0.25rem',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <XCircle size={18} />
                </button>
              </div>
            )}
            </div>
          </div>

        {/* Error Message */}
        {error && (
            <div style={{ 
            marginBottom: '1.5rem', 
            padding: '0.75rem 1rem',
            backgroundColor: '#FEF2F2',
            border: `1px solid ${colors.errorRed}`,
            borderRadius: '0.5rem',
            color: colors.errorRed, 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            fontSize: '0.875rem'
            }}>
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {/* CTA Button */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', marginRight: '60px' }}>
                 <button 
            onClick={() => {
              if (file) {
                analyzeResume();
              } else if (linkedinUrl.trim() && !linkedinUploadSuccess) {
                handleLinkedInSubmit();
              } else if (linkedinUploadSuccess) {
                // After LinkedIn upload success, show message that file upload is needed
                // (Backend doesn't support LinkedIn URL extraction yet)
                setError('Please upload a resume file. LinkedIn URL extraction is coming soon.');
              } else {
                triggerFileUpload();
              }
            }}
            disabled={!file && (!linkedinUrl.trim() || linkedinUploading)}
                   style={{ 
              backgroundColor: (file || (linkedinUrl.trim() && !linkedinUploading)) ? '#FF6B35' : '#D1D5DB', 
              color: '#FFFFFF', 
              fontWeight: 700, 
              padding: '0.875rem 2rem', 
              borderRadius: '0.5rem', 
              boxShadow: (file || (linkedinUrl.trim() && !linkedinUploading)) ? '0 4px 12px rgba(255, 107, 53, 0.3)' : 'none',
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '0.5rem',
              cursor: (file || (linkedinUrl.trim() && !linkedinUploading)) ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s',
              transform: 'scale(1)',
              border: 'none',
              fontSize: '1rem',
              fontFamily: "'Space Grotesk', sans-serif"
                   }}
            onMouseEnter={(e) => { 
              if (file || (linkedinUrl.trim() && !linkedinUploading)) {
                e.currentTarget.style.transform = 'scale(1.02)'; 
                e.currentTarget.style.backgroundColor = '#E55A2B'; 
              }
            }}
            onMouseLeave={(e) => { 
              if (file || (linkedinUrl.trim() && !linkedinUploading)) {
                e.currentTarget.style.transform = 'scale(1)'; 
                e.currentTarget.style.backgroundColor = '#FF6B35'; 
              }
            }}
          >
            Check Job match Score
                 </button>
               </div>
               </div>       

        {/* Helper Text */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          gap: '0.5rem',
          marginBottom: '2rem',
          marginRight: '60px'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            fontSize: '0.75rem',
            color: '#565D6D',
            marginBottom: '0.3rem',
            fontFamily: "Inter"
          }}>
            <span>Takes less than 30 seconds</span>
            <Clock size={14} style={{ color: '#6B7280' }} />
            </div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            fontSize: '0.75rem',
            color: '#565D6D',
            fontFamily: "Inter"
          }}>
            <span>Your data is 100% private and secure</span>
            <Lock size={14} style={{ color: '#6B7280' }} />
          </div>
        </div>

        {/* Footer Text */}
        <p style={{ 
          fontSize: '0.75rem', 
          color: '#6B7280', 
          textAlign: 'center',
          lineHeight: 1.5,
          fontFamily: "Inter",
          marginRight: '60px'
        }}>
          Next: See your personalized Job Match Report with skill gaps, readiness score, and learning roadmap.
        </p>
        

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// --- VIEW: ANALYZING (Skeleton UI) ---
if (step === 'analyzing') {
  // Determine which stage to show based on currentStep
  // currentStep 0 = Stage 1 (Scanning Keywords)
  // currentStep 1 = Stage 2 (Evaluating Job Match)
  // currentStep 2 = Stage 3 (Finalizing Analysis)
  const getStage = () => {
    if (currentStep === 0) return 1;
    if (currentStep === 1) return 2;
    if (currentStep === 2) return 3;
    // If currentStep is null but we're still in analyzing step, 
    // it means we're transitioning - keep showing stage 3
    if (step === 'analyzing' && currentStep === null) return 3;
    return 1; // Default to stage 1
  };

  const stage = getStage();

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#111827', 
      fontFamily: "'Sora', sans-serif",
      color: '#E5E7EB',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      overflow: 'hidden',
      position: 'relative'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@400&display=swap');
        
        .glassmorphism-dark {
          background: rgba(17, 24, 39, 0.3);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        @keyframes softGlow {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.03); opacity: 1; }
        }
        
        @keyframes ripple {
          0% { transform: scale(0.8); opacity: 0; }
          50% { opacity: 0.3; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes keywordAppear {
          0%, 100% { opacity: 0; transform: scale(0.9); }
          20%, 80% { opacity: 1; transform: scale(1); }
        }
        
        @keyframes pulseCore {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.85; }
        }
        
        @keyframes swirl {
          0% { transform: rotate(0deg) scale(1); opacity: 0.5; }
          50% { transform: rotate(180deg) scale(1.1); opacity: 0.7; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.5; }
        }
        
        @keyframes swirlReverse {
          0% { transform: rotate(0deg) scale(1); opacity: 0.4; }
          50% { transform: rotate(-180deg) scale(1.05); opacity: 0.6; }
          100% { transform: rotate(-360deg) scale(1); opacity: 0.4; }
        }
        
        @keyframes fadeInUp {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes dotPulse {
          0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        
        @keyframes factFade {
          0%, 90% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-5px); }
        }
        
        @keyframes progress-line-anim {
          0% { width: 20%; opacity: 0.5; }
          100% { width: 80%; opacity: 1; }
        }
        
        @keyframes converge1 {
          0% { transform: translate(0, 0) scale(1); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translate(0, 0) scale(0); opacity: 0.5; }
        }
        
        @keyframes converge2 {
          0% { transform: translate(0, 0) scale(1); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translate(0, 0) scale(0); opacity: 0.5; }
        }
        
        @keyframes dataGrow {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        
        @keyframes wavePulse {
          0%, 100% { transform: scaleY(1); opacity: 0.8; }
          50% { transform: scaleY(1.3); opacity: 1; }
        }
        
        .animate-soft-glow {
          animation: softGlow 3s ease-in-out infinite;
        }
        
        .animate-ripple {
          animation: ripple 2s ease-out infinite;
        }
        
        .animate-fade-in {
          animation: fadeIn 1s ease-out forwards;
        }
        
        .animate-keyword-appear-1 {
          animation: keywordAppear 5s ease-in-out infinite 0s;
        }
        
        .animate-keyword-appear-2 {
          animation: keywordAppear 5s ease-in-out infinite 1s;
        }
        
        .animate-keyword-appear-3 {
          animation: keywordAppear 5s ease-in-out infinite 2s;
        }
        
        .animate-keyword-appear-4 {
          animation: keywordAppear 5s ease-in-out infinite 3s;
        }
        
        .animate-pulse-core {
          animation: pulseCore 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        
        .animate-swirl {
          animation: swirl 8s ease-in-out infinite;
        }
        
        .animate-swirl-reverse {
          animation: swirlReverse 12s ease-in-out infinite;
        }
        
        .animate-fade-in-up {
          animation: fadeInUp 1s ease-out forwards;
        }
        
        .animate-dot-pulse-1 {
          animation: dotPulse 1.4s infinite ease-in-out both;
        }
        
        .animate-dot-pulse-2 {
          animation: dotPulse 1.4s 0.2s infinite ease-in-out both;
        }
        
        .animate-dot-pulse-3 {
          animation: dotPulse 1.4s 0.4s infinite ease-in-out both;
        }
        
        .animate-fact-fade {
          animation: factFade 8s ease-in-out infinite;
        }
        
        .animate-converge-1 {
          animation: converge1 2s ease-out infinite;
        }
        
        .animate-converge-2 {
          animation: converge2 2s ease-out infinite;
        }
        
        .animate-data-grow {
          animation: dataGrow 0.5s ease-out forwards;
        }
        
        .progress-line {
          position: absolute;
          top: 50%;
          left: 100%;
          height: 1px;
          background: linear-gradient(to right, #6366F1, transparent);
          transform-origin: left;
          animation: progress-line-anim 2s infinite alternate;
        }
      `}</style>
      
      {/* Background Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        maskImage: 'radial-gradient(ellipse at center, transparent 20%, black)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 20%, black)'
      }}></div>
      
      <div style={{
        width: '100%',
        maxWidth: '1024px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3rem',
        animation: stage === 3 ? 'fadeInUp 1s ease-out forwards' : 'fadeIn 1s ease-out forwards'
      }}>
        
        {/* STAGE 1: Scanning Keywords */}
        {stage === 1 && (
          <>
            <div style={{ position: 'relative', width: '256px', height: '256px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.5)',
                animation: 'ripple 2s ease-out infinite',
                animationDelay: '0s'
              }}></div>
              <div style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.5)',
                animation: 'ripple 2s ease-out infinite',
                animationDelay: '1s'
              }}></div>
              <div style={{
                position: 'relative',
                width: '112px',
                height: '112px',
                background: 'linear-gradient(to bottom right, #6366F1, #9333EA)',
                borderRadius: '50%',
                animation: 'softGlow 3s ease-in-out infinite',
                boxShadow: '0 25px 50px rgba(99, 102, 241, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '48px', zIndex: 10, opacity: 0.8 }}>auto_awesome</span>
              </div>
            </div>
            
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white', letterSpacing: '-0.025em' }}>
                AI Analysis in Progress...
              </h1>
              <p style={{ fontSize: '1.125rem', color: '#9CA3AF', maxWidth: '512px' }}>
                Our AI is starting to analyze your resume...
              </p>
            </div>
            
            <div style={{ width: '100%', maxWidth: '640px' }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1.5rem',
                padding: '1.5rem',
                borderRadius: '1rem',
                background: 'rgba(17, 24, 39, 0.3)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(99, 102, 241, 0.2)',
                    borderRadius: '50%',
                    border: '1px solid #6366F1',
                    animation: 'pulse 2s ease-in-out infinite'
                  }}>
                    <span className="material-symbols-outlined" style={{ color: '#818CF8', fontSize: '16px' }}>search</span>
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 600, color: 'white' }}>Scanning Keywords...</h3>
                  </div>
                </div>
                
                <div style={{ position: 'relative', width: '100%', height: '32px', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute',
                    width: '75%',
                    height: '1px',
                    background: 'linear-gradient(to right, transparent, #818CF8, transparent)'
                  }}></div>
                  <div style={{ position: 'absolute', left: '25%' }}>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.875rem',
                      color: '#C7D2FE',
                      background: 'rgba(99, 102, 241, 0.2)',
                      borderRadius: '0.375rem',
                      animation: 'keywordAppear 5s ease-in-out infinite 0s'
                    }}>Leadership</span>
                  </div>
                  <div style={{ position: 'absolute', left: '33%' }}>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.875rem',
                      color: '#C7D2FE',
                      background: 'rgba(99, 102, 241, 0.2)',
                      borderRadius: '0.375rem',
                      animation: 'keywordAppear 5s ease-in-out infinite 1s'
                    }}>React</span>
                  </div>
                  <div style={{ position: 'absolute', left: '50%' }}>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.875rem',
                      color: '#C7D2FE',
                      background: 'rgba(99, 102, 241, 0.2)',
                      borderRadius: '0.375rem',
                      animation: 'keywordAppear 5s ease-in-out infinite 2s'
                    }}>Agile</span>
                  </div>
                  <div style={{ position: 'absolute', right: '25%' }}>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.875rem',
                      color: '#C7D2FE',
                      background: 'rgba(99, 102, 241, 0.2)',
                      borderRadius: '0.375rem',
                      animation: 'keywordAppear 5s ease-in-out infinite 3s'
                    }}>Project Management</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div style={{ width: '100%', maxWidth: '512px', paddingTop: '2rem' }}>
              <div style={{ padding: '1rem', borderRadius: '1rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#6B7280', fontStyle: 'italic' }}>
                  Did you know? Tailoring your resume to each job can increase your chances of getting an interview.
                </p>
              </div>
            </div>
          </>
        )}
        
        {/* STAGE 2: Evaluating Job Match */}
        {stage === 2 && (
          <>
            <div style={{ position: 'relative', width: '256px', height: '256px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{
                position: 'absolute',
                width: '256px',
                height: '256px',
                borderRadius: '50%',
                border: '2px solid rgba(99, 102, 241, 0.3)',
                animation: 'swirl 8s ease-in-out infinite'
              }}></div>
              <div style={{
                position: 'absolute',
                width: '192px',
                height: '192px',
                borderRadius: '50%',
                border: '1px solid rgba(147, 51, 234, 0.4)',
                animation: 'swirlReverse 12s ease-in-out infinite'
              }}></div>
              <div style={{
                position: 'absolute',
                width: '128px',
                height: '128px',
                background: 'linear-gradient(to bottom right, #6366F1, #9333EA)',
                borderRadius: '50%',
                animation: 'pulseCore 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                boxShadow: '0 25px 50px rgba(99, 102, 241, 0.5)'
              }}></div>
              <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '48px', zIndex: 10, opacity: 0.9 }}>query_stats</span>
            </div>
            
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white', letterSpacing: '-0.025em' }}>
                AI Analysis in Progress...
              </h1>
              <p style={{ fontSize: '1.125rem', color: '#9CA3AF', maxWidth: '512px' }}>
                Our AI is meticulously analyzing your resume against the job description to provide you with powerful, data-driven insights.
              </p>
            </div>
            
            <div style={{ width: '100%', maxWidth: '512px' }}>
              <div style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '1.5rem',
                padding: '1.5rem',
                borderRadius: '1rem',
                background: 'rgba(17, 24, 39, 0.3)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                {/* Step 1: Complete */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '160px', opacity: 0.5 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(34, 197, 94, 0.2)',
                    borderRadius: '50%',
                    border: '1px solid #22C55E',
                    marginBottom: '0.5rem'
                  }}>
                    <span className="material-symbols-outlined" style={{ color: '#4ADE80', fontSize: '16px' }}>check</span>
                  </div>
                  <h3 style={{ fontWeight: 600, color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem' }}>Scanning Keywords</h3>
                  <p style={{ fontSize: '0.75rem', color: '#6B7280' }}>Complete</p>
                </div>
                
                {/* Step 2: Processing */}
                <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '160px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(99, 102, 241, 0.2)',
                    borderRadius: '50%',
                    border: '2px solid #818CF8',
                    marginBottom: '0.25rem'
                  }}>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <div style={{ width: '6px', height: '6px', background: '#C7D2FE', borderRadius: '50%', animation: 'dotPulse 1.4s infinite ease-in-out both' }}></div>
                      <div style={{ width: '6px', height: '6px', background: '#C7D2FE', borderRadius: '50%', animation: 'dotPulse 1.4s 0.2s infinite ease-in-out both' }}></div>
                      <div style={{ width: '6px', height: '6px', background: '#C7D2FE', borderRadius: '50%', animation: 'dotPulse 1.4s 0.4s infinite ease-in-out both' }}></div>
                    </div>
                  </div>
                  <h3 style={{ fontWeight: 600, color: 'white', fontSize: '1rem' }}>Evaluating Job Match</h3>
                  <p style={{ fontSize: '0.75rem', color: '#C7D2FE' }}>Processing...</p>
                  <div className="progress-line" style={{ width: '50%' }}></div>
                </div>
                
                {/* Step 3: Pending */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '160px', opacity: 0.5 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(107, 114, 128, 0.2)',
                    borderRadius: '50%',
                    border: '1px solid #4B5563',
                    marginBottom: '0.5rem'
                  }}>
                    <span className="material-symbols-outlined" style={{ color: '#6B7280', fontSize: '16px' }}>hourglass_top</span>
                  </div>
                  <h3 style={{ fontWeight: 600, color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.875rem' }}>Synthesizing Improvements</h3>
                  <p style={{ fontSize: '0.75rem', color: '#6B7280' }}>Pending</p>
                </div>
              </div>
            </div>
            
            <div style={{ width: '100%', maxWidth: '512px', paddingTop: '2rem' }}>
              <div style={{
                padding: '1.25rem',
                borderRadius: '1rem',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)',
                overflow: 'hidden'
              }}>
                <p key={currentFactIndex} style={{ fontSize: '0.875rem', color: '#D1D5DB', animation: 'factFade 8s ease-in-out infinite', transition: 'opacity 0.5s ease-in-out' }}>
                  <span style={{ fontWeight: 700, color: '#818CF8' }}>Did you know?</span> {didYouKnowFacts[currentFactIndex]}
                </p>
              </div>
            </div>
          </>
        )}
        
        {/* STAGE 3: Finalizing Analysis */}
        {stage === 3 && (
          <>
            <div style={{ position: 'relative', width: '256px', height: '256px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', width: '100%', height: '100%' }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  marginLeft: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#818CF8',
                  animation: 'converge1 2s ease-out infinite',
                  animationDelay: '0s'
                }}></div>
                <div style={{
                  position: 'absolute',
                  top: '25%',
                  left: 0,
                  marginLeft: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#A78BFA',
                  animation: 'converge1 2s ease-out infinite',
                  animationDelay: '0.2s',
                  transformOrigin: '128px 96px'
                }}></div>
                <div style={{
                  position: 'absolute',
                  top: '75%',
                  left: 0,
                  marginLeft: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#C7D2FE',
                  animation: 'converge1 2s ease-out infinite',
                  animationDelay: '0.4s',
                  transformOrigin: '128px -96px'
                }}></div>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  right: '50%',
                  marginRight: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#A855F7',
                  animation: 'converge2 2s ease-out infinite',
                  animationDelay: '0.6s'
                }}></div>
                <div style={{
                  position: 'absolute',
                  top: '25%',
                  right: 0,
                  marginRight: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#818CF8',
                  animation: 'converge2 2s ease-out infinite',
                  animationDelay: '0.8s',
                  transformOrigin: '-128px 96px'
                }}></div>
                <div style={{
                  position: 'absolute',
                  top: '75%',
                  right: 0,
                  marginRight: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#A78BFA',
                  animation: 'converge2 2s ease-out infinite',
                  animationDelay: '1s',
                  transformOrigin: '-128px -96px'
                }}></div>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  marginLeft: '-4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#C7D2FE',
                  animation: 'converge1 2s ease-out infinite',
                  animationDelay: '1.2s'
                }}></div>
              </div>
              <div style={{
                position: 'absolute',
                width: '112px',
                height: '112px',
                background: 'linear-gradient(to bottom right, #6366F1, #9333EA)',
                borderRadius: '50%',
                animation: 'pulseCore 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                boxShadow: '0 0 20px rgba(99, 102, 241, 0.5), 0 0 40px rgba(99, 102, 241, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '48px' }}>auto_awesome</span>
              </div>
            </div>
            
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'white', letterSpacing: '-0.025em' }}>
                Finalizing Your Analysis...
              </h1>
              <p style={{ fontSize: '1.125rem', color: '#C7D2FE', fontWeight: 500 }}>Get Ready!</p>
            </div>
            
            <div style={{ width: '100%', maxWidth: '512px' }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '1.5rem',
                borderRadius: '1rem',
                background: 'rgba(17, 24, 39, 0.3)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(99, 102, 241, 0.2)',
                    borderRadius: '50%',
                    border: '1px solid #6366F1',
                    animation: 'pulse 2s ease-in-out infinite'
                  }}>
                    <span className="material-symbols-outlined" style={{ color: '#818CF8', fontSize: '16px' }}>psychology</span>
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 600, color: 'white' }}>Synthesizing Improvements</h3>
                    <p style={{ fontSize: '0.875rem', color: '#9CA3AF' }}>Applying final enhancements...</p>
                  </div>
                </div>
                
                <div style={{
                  width: '100%',
                  height: '80px',
                  display: 'flex',
                  justifyContent: 'space-around',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  borderRadius: '0.5rem',
                  background: 'rgba(0, 0, 0, 0.2)'
                }}>
                  {[4, 8, 5, 10, 8, 12, 10, 16, 12, 10, 14, 12, 16, 10].map((height, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '8px',
                        height: `${height * 4}px`,
                        background: idx < 5 ? '#4ADE80' : idx < 10 ? '#818CF8' : '#A78BFA',
                        borderRadius: '0.25rem',
                        animation: `wavePulse 1.2s ease-in-out infinite`,
                        animationDelay: `${idx * 0.15}s`
                      }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>
            
            <div style={{ width: '100%', maxWidth: '512px', paddingTop: '1rem' }}>
              <div style={{
                padding: '1.25rem',
                borderRadius: '1rem',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)'
              }}>
                <p key={currentFactIndex} style={{ fontSize: '0.875rem', color: '#D1D5DB', animation: 'factFade 8s ease-in-out infinite', transition: 'opacity 0.5s ease-in-out' }}>
                  <span style={{ fontWeight: 700, color: '#818CF8' }}>💡 Did you know?</span> {didYouKnowFacts[currentFactIndex]}
                </p>
              </div>
            </div>
          </>
        )}
        
      </div>
    </div>
  );
}

  // Results Step
  if (step === 'results' && analysisData) {
    const parseResumeSections = (text, sectionsInfo = null) => {
      if (!text) return [];
      
      // Normalize Unicode bullet characters to standard format
      const normalizedText = text
        .replace(/\uf0b7/g, '•')  // Replace Unicode bullet
        .replace(/[\u2022\u2023\u2043\u2219\u25E6\u25AA\u25AB\u25CF\u25CB\u25D8]/g, '•'); // Normalize various bullets
      
      const lines = normalizedText.split('\n');
      const sections = [];
      let currentSection = null;
      let currentContent = [];
      
      // Comprehensive section header patterns
      const sectionPatterns = {
        header: /^(HEADER|CONTACT INFORMATION|CONTACT|NAME|PERSONAL DETAILS|PERSONAL INFORMATION)$/i,
        summary: /^(PROFESSIONAL SUMMARY|SUMMARY|OBJECTIVE|CAREER OBJECTIVE|PROFILE|ABOUT|ABOUT ME)$/i,
        skills: /^(TECHNICAL SKILLS|SKILLS|CORE COMPETENCIES|KEY SKILLS|COMPETENCIES|TECHNICAL COMPETENCIES|SOFTWARE KNOWLEDGE)$/i,
        experience: /^(PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EMPLOYMENT HISTORY|CAREER HISTORY|WORK HISTORY|INTERNSHIP|INTERNSHIPS|WORK EXPERIENCE\/TRAININGS)$/i,
        education: /^(EDUCATION|ACADEMIC BACKGROUND|ACADEMIC QUALIFICATIONS|QUALIFICATIONS|ACADEMIC DETAILS|ACADEMICS|ACADEMIC DETAILS)$/i,
        projects: /^(PROJECTS|KEY PROJECTS|PORTFOLIO PROJECTS|SELECTED PROJECTS|PROJECT EXPERIENCE|ACADEMIC PROJECTS|ENGINEERING PROJECTS)$/i,
        certifications: /^(CERTIFICATIONS|CERTIFICATES|PROFESSIONAL CERTIFICATIONS|CERTIFICATION)$/i,
        awards: /^(AWARDS|ACHIEVEMENTS|HONORS|RECOGNITIONS|ACHIEVEMENT)$/i,
        languages: /^(LANGUAGES|LANGUAGE PROFICIENCY|LANGUAGE)$/i,
        coding: /^(CODING PROFILE|CODING|COMPETITIVE PROGRAMMING|PROGRAMMING PROFILE)$/i,
        links: /^(LINKS|SOCIAL LINKS|PROFILES|ONLINE PROFILES|PROFILE LINKS)$/i,
        other: /^(OTHERS|OTHER|ADDITIONAL INFORMATION|MISCELLANEOUS|ADDITIONAL|PERSONAL INTERESTS|INTERESTS|OS|OPERATING SYSTEMS)$/i
      };
      
      const detectSectionType = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        
        // First check explicit section headers
        for (const [type, pattern] of Object.entries(sectionPatterns)) {
          if (pattern.test(trimmed)) {
            return type === 'other' ? 'other' : type;
          }
        }
        
        // Check for all-caps section headers (more strict criteria)
        // Must be: all caps, reasonable length, no special content indicators
        if (trimmed.length >= 2 && trimmed.length <= 50 && 
            trimmed === trimmed.toUpperCase() && 
            /^[A-Z\s&/]+$/.test(trimmed)) {
          // Exclude lines that look like content
          const isContent = 
            trimmed.includes('|') ||           // Has separator (job title | company)
            /^\d/.test(trimmed) ||             // Starts with number
            trimmed.includes('@') ||           // Has email
            /\d{10}/.test(trimmed) ||          // Has phone number
            trimmed.includes(':') ||           // Has colon (might be field label)
            /^[•·\-*]/.test(trimmed) ||        // Starts with bullet
            trimmed.split(' ').length > 8;      // Too many words (likely content)
          
          if (!isContent) {
            // Check if previous line was empty or this is first line
            return 'other';
          }
        }
        
        return null;
      };
      
      const inferSectionType = (sectionName) => {
        const nameLower = sectionName.toLowerCase();
        if (/header|contact|name|personal/i.test(nameLower)) return 'header';
        if (/summary|objective|profile|about/i.test(nameLower)) return 'summary';
        if (/skill|competenc/i.test(nameLower)) return 'skills';
        if (/experience|work|employment|career|job/i.test(nameLower)) return 'experience';
        if (/education|academic|qualification|degree/i.test(nameLower)) return 'education';
        if (/project/i.test(nameLower)) return 'projects';
        if (/certif/i.test(nameLower)) return 'certifications';
        if (/award|achievement|honor/i.test(nameLower)) return 'awards';
        if (/language/i.test(nameLower)) return 'languages';
        if (/coding|programming|competitive/i.test(nameLower)) return 'coding';
        if (/link|profile|social/i.test(nameLower)) return 'links';
        if (/os|operating/i.test(nameLower)) return 'other';
        return 'other';
      };
      
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        const sectionType = detectSectionType(trimmed);
        
        if (sectionType) {
          // Save previous section if it exists
          if (currentSection) {
            const content = currentContent.join('\n').trim();
            if (content || currentSection.name) {
              sections.push({
                ...currentSection,
                content: content
              });
            }
          }
          
          // Start new section
          currentSection = {
            name: trimmed,
            type: sectionType === 'other' ? inferSectionType(trimmed) : sectionType,
            isNew: sectionsInfo?.new_sections_added?.includes(trimmed) || false
          };
          currentContent = [];
        } else if (trimmed) {
          // This is content, add it to current section
          if (!currentSection) {
            // No section yet, create a default one
            currentSection = {
              name: 'RESUME CONTENT',
              type: 'other',
              isNew: false
            };
          }
          currentContent.push(line);
        } else {
          // Empty line - preserve spacing but don't add multiple consecutive empty lines
          if (currentContent.length > 0 && currentContent[currentContent.length - 1] !== '') {
            currentContent.push('');
          }
        }
      });
      
      // Add last section
      if (currentSection) {
        const content = currentContent.join('\n').trim();
        if (content || currentSection.name) {
          sections.push({
            ...currentSection,
            content: content
          });
        }
      }
      
      // If no sections detected or only one empty section, try grouping
      if (sections.length === 0 || (sections.length === 1 && !sections[0].content)) {
        return groupUnstructuredContent(text, sectionsInfo);
      }
      
      return sections;
    };
    
    const groupUnstructuredContent = (text, sectionsInfo) => {
      const lines = text.split('\n').filter(l => l.trim());
      const sections = [];
      let currentGroup = [];
      let currentGroupType = 'other';
      let groupName = 'RESUME CONTENT';
      
      // Helper function to infer section type
      const inferSectionType = (content) => {
        if (!content) return null;
        const contentLower = content.toLowerCase();
        if (/\b(education|academic|qualification|degree|university|college|school|b\.tech|b\.e\.|m\.tech)\b/i.test(contentLower)) return 'education';
        if (/\b(experience|work|employment|career|job|role|position)\b/i.test(contentLower)) return 'experience';
        if (/\b(skill|competenc|proficient|expert|tools|technologies)\b/i.test(contentLower)) return 'skills';
        if (/\b(project|portfolio|developed|built|created)\b/i.test(contentLower)) return 'projects';
        if (/\b(certification|certificate)\b/i.test(contentLower)) return 'certifications';
        return null;
      };
      
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        
        // Try to detect section boundaries
        const isEducation = /\b(B\.Tech|B\.E\.|B\.Sc\.|M\.Tech|University|College|School|Class X|Class XII|CGPA|GPA|%)\b/i.test(trimmed);
        const isExperience = /\b(Experience|Worked|Company|Organization|Role|Position)\b/i.test(trimmed);
        const isSkills = /\b(Skills|Proficient|Expert|Tools|Technologies)\b/i.test(trimmed);
        const isProject = /\b(Project|Developed|Built|Created)\b/i.test(trimmed);
        const isHeader = trimmed.length < 50 && trimmed === trimmed.toUpperCase() && !trimmed.includes('|');
        
        let detectedType = null;
        if (isEducation) detectedType = 'education';
        else if (isExperience) detectedType = 'experience';
        else if (isSkills) detectedType = 'skills';
        else if (isProject) detectedType = 'projects';
        
        // If we detect a new section type and have content, save previous group
        if (detectedType && detectedType !== currentGroupType && currentGroup.length > 0) {
          sections.push({
            name: groupName,
            type: currentGroupType,
            content: currentGroup.join('\n').trim(),
            isNew: false
          });
          currentGroup = [];
          currentGroupType = detectedType;
          groupName = isHeader ? trimmed : (detectedType === 'education' ? 'EDUCATION' : 
                                            detectedType === 'experience' ? 'EXPERIENCE' :
                                            detectedType === 'skills' ? 'SKILLS' :
                                            detectedType === 'projects' ? 'PROJECTS' : 'RESUME CONTENT');
        } else if (isHeader && currentGroup.length > 0) {
          // Save current group and start new one
          sections.push({
            name: groupName,
            type: currentGroupType,
            content: currentGroup.join('\n').trim(),
            isNew: false
          });
          currentGroup = [];
          currentGroupType = inferSectionType(trimmed) || 'other';
          groupName = trimmed;
        } else if (detectedType && currentGroup.length === 0) {
          currentGroupType = detectedType;
          groupName = isHeader ? trimmed : (detectedType === 'education' ? 'EDUCATION' : 
                                            detectedType === 'experience' ? 'EXPERIENCE' :
                                            detectedType === 'skills' ? 'SKILLS' :
                                            detectedType === 'projects' ? 'PROJECTS' : 'RESUME CONTENT');
        }
        
        currentGroup.push(line);
      });
      
      // Add last group
      if (currentGroup.length > 0) {
        sections.push({
          name: groupName,
          type: currentGroupType,
          content: currentGroup.join('\n').trim(),
          isNew: false
        });
      }
      
      return sections.length > 0 ? sections : [{
        name: 'RESUME CONTENT',
        type: 'other',
        content: text,
        isNew: false
      }];
    };
    
    // ============================================================================
    // Specialized Header Formatting Helpers
    // ============================================================================
    
    /**
     * Helper function to find URL from extracted links by matching text patterns
     * @param {string} lineText - The text line from resume
     * @param {Array} extractedLinks - Array of {text, url} objects from PDF extraction
     * @param {string} linkType - Type of link to match ('linkedin', 'github', 'kaggle', 'email', 'portfolio')
     * @returns {string|null} - The actual URL if found, null otherwise
     */
    const findUrlFromExtractedLinks = (lineText, extractedLinks, linkType) => {
      if (!extractedLinks || extractedLinks.length === 0) return null;
      
      // Extract key identifiers from line text (domain, username, email)
      const extractKeyParts = (text) => {
        const lower = text.toLowerCase();
        // Extract LinkedIn profile
        const linkedinMatch = lower.match(/linkedin\.com\/in\/([a-z0-9_-]+)/i);
        if (linkedinMatch) return `linkedin:${linkedinMatch[1]}`;
        // Extract GitHub username
        const githubMatch = lower.match(/github\.com\/([a-z0-9_-]+)/i);
        if (githubMatch) return `github:${githubMatch[1]}`;
        // Extract Kaggle username
        const kaggleMatch = lower.match(/kaggle\.com\/([a-z0-9_-]+)/i);
        if (kaggleMatch) return `kaggle:${kaggleMatch[1]}`;
        // Extract email
        const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
        if (emailMatch) return `email:${emailMatch[1].toLowerCase()}`;
        // Extract any URL domain
        const urlMatch = lower.match(/(https?:\/\/)?(www\.)?([a-z0-9.-]+\.[a-z]{2,})/i);
        if (urlMatch) return `url:${urlMatch[3]}`;
        return null;
      };
      
      const lineKey = extractKeyParts(lineText);
      // ✅ Fallback mode: If no lineKey but line text contains keywords, try to match with extracted links
      if (!lineKey) {
        const lowerLineText = lineText.toLowerCase();
        
        // Check if line text contains keywords for the link type
        const hasKeyword = 
          (linkType === 'linkedin' && lowerLineText.includes('linkedin')) ||
          (linkType === 'github' && lowerLineText.includes('github')) ||
          (linkType === 'kaggle' && lowerLineText.includes('kaggle')) ||
          (linkType === 'email' && (lowerLineText.includes('@') || lowerLineText.includes('email')));
        
        if (hasKeyword) {
          for (const link of extractedLinks) {
            if (!link.url || !link.text) continue;
            
            const url = link.url.toLowerCase();
            const linkText = link.text.toLowerCase();
            
            // Match if link text contains the keyword or if URL matches the type
            const textMatches = 
              (linkType === 'linkedin' && (linkText.includes('linkedin') || url.includes('linkedin.com'))) ||
              (linkType === 'github' && (linkText.includes('github') || url.includes('github.com'))) ||
              (linkType === 'kaggle' && (linkText.includes('kaggle') || url.includes('kaggle.com'))) ||
              (linkType === 'email' && (linkText.includes('@') || url.includes('@') || url.startsWith('mailto:')));
            
            if (textMatches) {
              if (linkType === 'linkedin' && url.includes('linkedin.com')) {
                return link.url;
              } else if (linkType === 'github' && url.includes('github.com')) {
                return link.url;
              } else if (linkType === 'kaggle' && url.includes('kaggle.com')) {
                return link.url;
              } else if (linkType === 'email' && (url.startsWith('mailto:') || url.includes('@'))) {
                return url.startsWith('mailto:') ? url.replace('mailto:', '') : url;
              }
            }
          }
        }
        return null;
      }
      
      
      for (const link of extractedLinks) {
        if (!link.text || !link.url) continue;
        
        const linkKey = extractKeyParts(link.text);
        if (!linkKey) continue;
        
        // Match if keys are the same or if one contains the other
        const keysMatch = lineKey === linkKey || 
                         lineKey.includes(linkKey.split(':')[1]) || 
                         linkKey.includes(lineKey.split(':')[1]);
        
        if (keysMatch) {
          // Verify the link type matches
          const url = link.url.toLowerCase();
          if (linkType === 'linkedin' && url.includes('linkedin.com')) {
            return link.url; // Return full URL with query params
          } else if (linkType === 'github' && url.includes('github.com')) {
            return link.url;
          } else if (linkType === 'kaggle' && url.includes('kaggle.com')) {
            return link.url;
          } else if (linkType === 'email' && (url.startsWith('mailto:') || url.includes('@'))) {
            return url.startsWith('mailto:') ? url.replace('mailto:', '') : url;
          } else if (linkType === 'portfolio' && (url.startsWith('http://') || url.startsWith('https://'))) {
            // Only return if it's not a known social platform
            if (!url.includes('linkedin') && !url.includes('github') && !url.includes('kaggle')) {
              return link.url;
            }
          }
        }
      }
      
      return null;
    };
    
    const parseHeaderContent = (content, extractedLinks = []) => {
      if (!content && (!extractedLinks || extractedLinks.length === 0)) return null;
    
      const lines = content
        ? content.split('\n').map(l => l.trim()).filter(Boolean)
        : [];
    
      const headerData = {
        name: '',
        location: '',
        phone: '',
        email: '',
        linkedin: '',
        github: '',
        kaggle: '',
        portfolio: '',
        other: []
      };
    
      // ============== Line-based parsing ==============
      lines.forEach((line, idx) => {
        // First non-empty line is the name
        if (idx === 0 && !line.includes('@') && !line.match(/\d{10}/) && !line.includes('|')) {
          headerData.name = line.replace(/\*\*/g, '').trim();
          return;
        }
        
        // Special handling for lines with pipe separators (common in improved resumes)
        // Example: "email | phone | location | linkedin"
        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim()).filter(Boolean);
          
          parts.forEach(part => {
            // Email detection
            if (!headerData.email) {
              const extractedEmail = findUrlFromExtractedLinks(part, extractedLinks, 'email');
              if (extractedEmail) {
                headerData.email = extractedEmail;
                return;
              }
              
              const emailMatch = part.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
              if (emailMatch) {
                headerData.email = emailMatch[1];
                return;
              }
            }
            
            // Phone detection
            if (!headerData.phone) {
              const phoneMatch = part.match(/(\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{4,10}|\d{10,12}/);
              if (phoneMatch) {
                headerData.phone = phoneMatch[0].trim();
                return;
              }
            }
            
            // Location detection (city, state/country format)
            if (!headerData.location && part.match(/,/) && !part.includes('@') && !part.match(/\d{10}/) && part.split(',').length === 2) {
              headerData.location = part;
              return;
            }
            
            // LinkedIn detection
            if (!headerData.linkedin) {
              if (part.toLowerCase().includes('linkedin') || part.match(/linkedin\.com/i)) {
                const extractedLinkedIn = findUrlFromExtractedLinks(part, extractedLinks, 'linkedin');
                if (extractedLinkedIn) {
                  headerData.linkedin = extractedLinkedIn;
                  return;
                }
                
                // Pattern matching for linkedin.com URLs
                if (part.match(/linkedin\.com/i)) {
                  const linkedinMatch = part.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
                  if (linkedinMatch) {
                    headerData.linkedin = linkedinMatch[0].startsWith('http')
                      ? linkedinMatch[0]
                      : 'https://' + linkedinMatch[0];
                    return;
                  }
                }
              }
            }
            
            // GitHub detection
            if (!headerData.github && (part.toLowerCase().includes('github') || part.match(/github\.com/i))) {
              const extractedGitHub = findUrlFromExtractedLinks(part, extractedLinks, 'github');
              if (extractedGitHub) {
                headerData.github = extractedGitHub;
                return;
              }
              
              if (part.match(/github\.com/i)) {
                const githubMatch = part.match(/(https?:\/\/)?(www\.)?github\.com\/([a-zA-Z0-9_-]+)/i);
                if (githubMatch) {
                  headerData.github = githubMatch[0].startsWith('http')
                    ? githubMatch[0]
                    : 'https://' + githubMatch[0];
                  return;
                }
              }
            }
          });
          
          // After processing pipe-separated line, don't process it further
          return;
        }
    
        // Regular line-by-line parsing (for non-pipe-separated lines)
        // Email detection
        const extractedEmail = findUrlFromExtractedLinks(line, extractedLinks, 'email');
        if (extractedEmail) {
          headerData.email = extractedEmail;
          return;
        }
    
        const emailMatch = line.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
        if (emailMatch) {
          headerData.email = emailMatch[1];
          return;
        }
    
        // Phone detection - handle various formats including country codes
        // Matches: +91 9983076627, +1-555-123-4567, (555) 123-4567, 9983076627, etc.
        const phoneMatch = line.match(/(\+?\d{1,4}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{4,10}|\d{10,12}/);
        if (phoneMatch) {
          headerData.phone = phoneMatch[0].trim();
          return;
        }
    
        // ✅ LinkedIn detection (extracted links first)
        // Check if line contains "linkedin" keyword (case-insensitive)
        if (line.toLowerCase().includes('linkedin')) {
          const extractedLinkedIn = findUrlFromExtractedLinks(line, extractedLinks, 'linkedin');
          if (extractedLinkedIn) {
            headerData.linkedin = extractedLinkedIn;
            return;
          }
        }
    
        // Fallback: pattern matching if linkedin.com is in the text
        if (line.match(/linkedin\.com/i)) {
          const linkedinMatch = line.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
          if (linkedinMatch) {
            headerData.linkedin = linkedinMatch[0].startsWith('http')
              ? linkedinMatch[0]
              : 'https://' + linkedinMatch[0];
          } else {
            headerData.linkedin = line.includes('http') ? line : 'https://' + line;
          }
          return;
        }
    
        // GitHub detection
        const extractedGitHub = findUrlFromExtractedLinks(line, extractedLinks, 'github');
        if (extractedGitHub) {
          headerData.github = extractedGitHub;
          return;
        }
    
        if (line.match(/github\.com/i)) {
          const githubMatch = line.match(/(https?:\/\/)?(www\.)?github\.com\/([a-zA-Z0-9_-]+)/i);
          if (githubMatch) {
            headerData.github = githubMatch[0].startsWith('http')
              ? githubMatch[0]
              : 'https://' + githubMatch[0];
          }
          return;
        }
    
        // Kaggle detection
        const extractedKaggle = findUrlFromExtractedLinks(line, extractedLinks, 'kaggle');
        if (extractedKaggle) {
          headerData.kaggle = extractedKaggle;
          return;
        }
    
        if (line.match(/kaggle\.com/i)) {
          const kaggleMatch = line.match(/(https?:\/\/)?(www\.)?kaggle\.com\/([a-zA-Z0-9_-]+)/i);
          if (kaggleMatch) {
            headerData.kaggle = kaggleMatch[0].startsWith('http')
              ? kaggleMatch[0]
              : 'https://' + kaggleMatch[0];
          }
          return;
        }
    
        // Portfolio detection
        const extractedPortfolio = findUrlFromExtractedLinks(line, extractedLinks, 'portfolio');
        if (extractedPortfolio) {
          headerData.portfolio = extractedPortfolio;
          return;
        }
    
        if (line.match(/https?:\/\/|www\./i) && !line.match(/linkedin|github|kaggle/i)) {
          headerData.portfolio = line.startsWith('http') ? line : 'https://' + line;
          return;
        }
    
        // Location detection
        if (line.match(/,/) && !line.includes('@') && !line.match(/\d{10}/) && line.split(',').length === 2) {
          headerData.location = line;
          return;
        }
    
        // Other
        headerData.other.push(line);
      });
    
      // ============== ✅ Fallback extraction from extractedLinks only ==============
      if (!headerData.email) {
        headerData.email = findUrlFromExtractedLinks('', extractedLinks, 'email') || '';
      }
    
      if (!headerData.linkedin) {
        headerData.linkedin = findUrlFromExtractedLinks('', extractedLinks, 'linkedin') || '';
      }
    
      if (!headerData.github) {
        headerData.github = findUrlFromExtractedLinks('', extractedLinks, 'github') || '';
      }
    
      if (!headerData.kaggle) {
        headerData.kaggle = findUrlFromExtractedLinks('', extractedLinks, 'kaggle') || '';
      }
    
      if (!headerData.portfolio) {
        headerData.portfolio = findUrlFromExtractedLinks('', extractedLinks, 'portfolio') || '';
      }
    
      return headerData;
    };    

    const renderImprovedHeader = (headerData) => {
      if (!headerData) return null;
      
      // Build contact line with separators (phone, email, LinkedIn)
      const contactParts = [];
      
      if (headerData.phone) {
        const cleanPhone = headerData.phone.replace(/\D/g, '');
        contactParts.push(
          `<a href="tel:+${cleanPhone}" style="color: #000000; text-decoration: none;">${headerData.phone}</a>`
        );
      }
      if (headerData.email) {
        contactParts.push(
          `<a href="mailto:${headerData.email}" style="color: #000000; text-decoration: none;">${headerData.email}</a>`
        );
      }
      if (headerData.linkedin) {
        contactParts.push(
          `<a href="${headerData.linkedin}" target="_blank" rel="noopener noreferrer" style="color: #000000; text-decoration: none;">LinkedIn</a>`
        );
      }
      
      // Other links (GitHub, Kaggle, Portfolio) - separate line if needed
      const otherLinkParts = [];
      if (headerData.github) {
        otherLinkParts.push(
          `<a href="${headerData.github}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">GitHub</a>`
        );
      }
      if (headerData.kaggle) {
        otherLinkParts.push(
          `<a href="${headerData.kaggle}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">Kaggle</a>`
        );
      }
      if (headerData.portfolio) {
        otherLinkParts.push(
          `<a href="${headerData.portfolio}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">Portfolio</a>`
        );
      }
      
      return (
        <div style={{ marginBottom: '1.2rem', textAlign: 'center' }}>
          {/* Name - Bold and Prominent */}
          <div style={{ 
            fontSize: '18pt', 
            fontWeight: 700, 
            color: '#000000', 
            marginBottom: '0.4rem', 
            lineHeight: '1.2', 
            fontFamily: 'Helvetica, Arial, sans-serif',
            letterSpacing: '0.02em'
          }}>
            {headerData.name}
          </div>
          
          {/* Location - First Line */}
          {headerData.location && (
            <div 
              style={{ 
                fontSize: '10pt', 
                color: '#000000', 
                marginBottom: '0.3rem', 
                lineHeight: '1.4', 
                fontFamily: 'Helvetica, Arial, sans-serif'
              }}
            >
              {headerData.location}
            </div>
          )}
          
          {/* Contact Info - Second Line (Phone, Email, LinkedIn) */}
          {contactParts.length > 0 && (
            <div 
              style={{ 
                fontSize: '10pt', 
                color: '#000000', 
                marginBottom: '0.3rem', 
                lineHeight: '1.4', 
                fontFamily: 'Helvetica, Arial, sans-serif'
              }}
              dangerouslySetInnerHTML={{ 
                __html: contactParts.join(' <span style="color: #9ca3af; margin: 0 0.3rem;">|</span> ')
              }}
            />
          )}
          
          {/* Other Links - Third Line (GitHub, Kaggle, Portfolio) if any */}
          {otherLinkParts.length > 0 && (
            <div 
              style={{ 
                fontSize: '10pt', 
                color: '#2563eb', 
                lineHeight: '1.4', 
                fontFamily: 'Helvetica, Arial, sans-serif'
              }}
              dangerouslySetInnerHTML={{ 
                __html: otherLinkParts.join(' <span style="color: #9ca3af; margin: 0 0.3rem;">|</span> ')
              }}
            />
          )}
          
          {/* Other info if any */}
          {headerData.other.map((item, idx) => (
            <div 
              key={idx}
              style={{ 
                fontSize: '9.5pt', 
                color: '#4b5563', 
                lineHeight: '1.4', 
                fontFamily: 'Helvetica, Arial, sans-serif',
                marginTop: '0.2rem'
              }}
            >
              {item}
            </div>
          ))}
        </div>
      );
    };
    
    const renderOriginalHeader = (headerData) => {
      if (!headerData) return null;
      
      return (
        <div style={{ marginBottom: '1rem' }}>
          {headerData.name && (
            <div style={{ 
              fontSize: '16pt', 
              fontWeight: 700, 
              color: '#000000', 
              marginBottom: '0.5rem', 
              lineHeight: '1.2', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              {headerData.name}
            </div>
          )}
          
          {headerData.location && (
            <div style={{ 
              fontSize: '10pt', 
              color: '#000000', 
              marginBottom: '0.15rem', 
              lineHeight: '1.4', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              {headerData.location}
            </div>
          )}
          
          {headerData.phone && (
            <div style={{ 
              fontSize: '10pt', 
              color: '#000000', 
              marginBottom: '0.15rem', 
              lineHeight: '1.4', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              <a 
                href={`tel:+${headerData.phone.replace(/\D/g, '')}`} 
                style={{ color: '#000000', textDecoration: 'none' }}
              >
                {headerData.phone}
              </a>
            </div>
          )}
          
          {headerData.email && (
            <div style={{ 
              fontSize: '10pt', 
              color: '#000000', 
              marginBottom: '0.15rem', 
              lineHeight: '1.4', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              <a 
                href={`mailto:${headerData.email}`} 
                style={{ color: '#000000', textDecoration: 'none' }}
              >
                {headerData.email}
              </a>
            </div>
          )}
          
          {headerData.linkedin && (
            <div style={{ 
              fontSize: '10pt', 
              color: '#2563eb', 
              marginBottom: '0.15rem', 
              lineHeight: '1.4', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              <a 
                href={headerData.linkedin} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#2563eb', textDecoration: 'none' }}
              >
                {headerData.linkedin.replace(/https?:\/\/(www\.)?/, '')}
              </a>
            </div>
          )}
          
          {headerData.github && (
            <div style={{ 
              fontSize: '10pt', 
              color: '#2563eb', 
              marginBottom: '0.15rem', 
              lineHeight: '1.4', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              <a 
                href={headerData.github} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#2563eb', textDecoration: 'none' }}
              >
                GitHub
              </a>
            </div>
          )}
          
          {headerData.kaggle && (
            <div style={{ 
              fontSize: '10pt', 
              color: '#2563eb', 
              marginBottom: '0.15rem', 
              lineHeight: '1.4', 
              fontFamily: 'Helvetica, Arial, sans-serif'
            }}>
              <a 
                href={headerData.kaggle} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#2563eb', textDecoration: 'none' }}
              >
                Kaggle
              </a>
            </div>
          )}
          
          {headerData.other.map((item, idx) => (
            <div 
              key={idx}
              style={{ 
                fontSize: '9.5pt', 
                color: '#4b5563', 
                marginBottom: '0.15rem', 
                lineHeight: '1.4', 
                fontFamily: 'Helvetica, Arial, sans-serif'
              }}
            >
              {item}
            </div>
          ))}
        </div>
      );
    };
    
    const formatHeaderSection = (content, isImproved = false, extractedLinks = []) => {
      const headerData = parseHeaderContent(content, extractedLinks);
      if (!headerData) return null;
      return isImproved ? renderImprovedHeader(headerData) : renderOriginalHeader(headerData);
    };
    // ============================================================================
    
    const formatSectionContent = (content, sectionType, compact = false, isImproved = false, extractedLinks = []) => {
      if (!content) return null;
      if (sectionType === 'header') {
        return formatHeaderSection(content, isImproved, extractedLinks);
      }
      
      // Normalize Unicode bullets
      let normalizedContent = content
        .replace(/\uf0b7/g, '•')
        .replace(/[\u2022\u2023\u2043\u2219\u25E6\u25AA\u25AB\u25CF\u25CB\u25D8]/g, '•');
      
      if (sectionType === 'header') {
        normalizedContent = normalizedContent.replace(/\*\*(.*?)\*\*/g, '$1');
      }
      
      const lines = normalizedContent.split('\n');
      const formattedLines = [];
      
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
        
          if (idx > 0 && idx < lines.length - 1 && lines[idx - 1].trim() && lines[idx + 1].trim()) {
            formattedLines.push({ type: 'break', key: `break-${idx}` });
          }
          return;
        }
        
        // Use same detection logic as PDF download function for consistency
        const isBullet = /^[•·\-*]/.test(trimmed) || /^\d+\./.test(trimmed);
        const isJobHeader = /^.+ \| .+$/.test(trimmed) && sectionType === 'experience';
        const isDateLine = /^\d{4}|\w+ \d{4}|Present|Current/i.test(trimmed) && sectionType === 'experience';
        const isDegreeLine = /\b(B\.Tech|B\.E\.|B\.Sc\.|M\.Tech|M\.B\.A|Degree)\b/i.test(trimmed) && sectionType === 'education';
        const isNameLine = sectionType === 'header' && !trimmed.includes('|') && !trimmed.includes('@') && trimmed.length < 50 && trimmed.split(' ').length <= 4;
        
        // Check for contact info (email, phone)
        const isContactLine = sectionType === 'header' && 
                              (trimmed.includes('@') || 
                               /Email|Phone|Mob|Mobile|Contact/i.test(trimmed) ||
                               /\d{10}/.test(trimmed));
        
        // Check for project title (may include [Course Project] or [Academic Project])
        // Project title is usually: not a bullet, not technologies line, and either has brackets or is a substantial standalone line
        const isProjectTitle = sectionType === 'projects' && 
                               !isBullet && 
                               !trimmed.toLowerCase().startsWith('technologies:') &&
                               (trimmed.includes('[') || 
                                (trimmed.length > 10 && trimmed.length < 100 && 
                                 !trimmed.includes(':') && 
                                 !trimmed.match(/^\d+[.)]/)));
        
        // Check for Technologies line in projects section
        const isTechnologiesLine = sectionType === 'projects' && 
                                    /^Technologies:\s*/i.test(trimmed);
        
        if (isNameLine) {
          formattedLines.push({ type: 'name-header', content: trimmed, key: `name-${idx}` });
        } else if (isContactLine) {
          formattedLines.push({ type: 'contact', content: trimmed, key: `contact-${idx}` });
        } else if (isJobHeader) {
          formattedLines.push({ type: 'job-header', content: trimmed, key: `job-${idx}` });
        } else if (isDateLine) {
          formattedLines.push({ type: 'date', content: trimmed, key: `date-${idx}` });
        } else if (isDegreeLine) {
          formattedLines.push({ type: 'degree', content: trimmed, key: `degree-${idx}` });
        } else if (isProjectTitle) {
          formattedLines.push({ type: 'project-title', content: trimmed, key: `project-${idx}` });
        } else if (isTechnologiesLine) {
          const techContent = trimmed.replace(/^Technologies:\s*/i, '');
          formattedLines.push({ type: 'technologies', content: techContent, key: `tech-${idx}` });
        } else if (isBullet) {
          // Remove bullet character and clean up (matching PDF logic)
          const bulletText = trimmed.replace(/^[•·\-*\d+.]\s*/, '');
          formattedLines.push({ type: 'bullet', content: bulletText, key: `bullet-${idx}` });
        } else {
          // Regular text
          formattedLines.push({ type: 'text', content: trimmed, key: `text-${idx}` });
        }
      });
      
      // Render formatted lines - ATS-friendly styling matching PDF output
      const lineHeight = compact ? 1.35 : 1.5;
      const smallLineHeight = compact ? 1.25 : 1.4;
      const sectionSpacing = compact ? '0.35rem' : '0.5rem';
      const bulletMargin = compact ? '0.1rem' : '0.2rem';
      const textMargin = compact ? '0.1rem' : '0.2rem';
      
      return formattedLines.map((item) => {
        switch (item.type) {
          case 'break':
            return <br key={item.key} />;
          
          case 'name-header':
            return (
              <div key={item.key} style={{ fontSize: '12pt', fontWeight: 700, color: '#000000', marginBottom: sectionSpacing, lineHeight: '1.2', fontFamily: 'Helvetica, Arial, sans-serif' }}>
                {item.content}
              </div>
            );
          
          case 'contact':
            return (
              <div key={item.key} style={{ fontSize: '9pt', color: '#000000', marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                {item.content}
              </div>
            );
          
          case 'job-header':
            return (
              <div key={item.key} style={{ fontSize: '10pt', fontWeight: 700, color: '#000000', marginTop: sectionSpacing, marginBottom: '0.1rem', lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                {item.content}
              </div>
            );
          
          case 'date':
            return (
              <div key={item.key} style={{ fontSize: '9pt', color: '#000000', marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                {item.content}
              </div>
            );
          
          case 'degree':
            return (
              <div key={item.key} style={{ fontSize: '10pt', fontWeight: 700, color: '#000000', marginTop: sectionSpacing, marginBottom: '0.1rem', lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                {item.content}
              </div>
            );
          
          case 'project-title':
            // Check if project is in projects_added from step 3 LLM response
            // Extract clean project name (remove [CN Project] marker and any text after |)
            const cleanProjectTitle = item.content
              .replace(/\[CN Project\]/g, '')
              .split('|')[0]
              .trim();
            
            // Get projects_added from analysisData
            const projectsAdded = analysisData?.improved?.projects_added || [];
            
            // Check if this project matches any project in projects_added
            // Use flexible matching (case-insensitive, partial match)
            const isAddedProject = projectsAdded.some(addedProject => {
              const normalizedAdded = addedProject.toLowerCase().trim();
              const normalizedTitle = cleanProjectTitle.toLowerCase().trim();
              // Check for exact match or if title contains the added project name
              return normalizedTitle === normalizedAdded || 
                     normalizedTitle.includes(normalizedAdded) ||
                     normalizedAdded.includes(normalizedTitle);
            });
            
            // Remove [CN Project] marker from display text
            const displayText = item.content.replace(/\[CN Project\]/g, '').trim();
            
            return (
              <div key={item.key} style={{ fontSize: '10pt', fontWeight: 700, color: '#000000', marginTop: sectionSpacing, marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                {isAddedProject ? (
                  <>
                    <span>{displayText}</span>
                          <img 
                            src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTEMYetPQ2J3r1xQQ36xkvL0HRXp7p_YH4mgA&s" 
                            alt="Coding Ninjas" 
                            style={{ 
                              height: '12px', 
                              width: 'auto', 
                              verticalAlign: 'middle',
                              display: 'inline-block'
                            }} 
                          />
                  </>
                ) : (
                  displayText
                )}
              </div>
            );
          
          case 'technologies':
            return (
              <div key={item.key} style={{ fontSize: '10pt', color: '#000000', marginBottom: textMargin, lineHeight: smallLineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                <span style={{ fontWeight: 700 }}>Technologies:</span> {item.content}
              </div>
            );
          
          case 'bullet':
            return (
              <div key={item.key} style={{ paddingLeft: '0.4rem', marginBottom: bulletMargin, color: '#000000', fontSize: '10pt', lineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                <span style={{ marginRight: '0.3rem' }}>-</span>
                <span>{item.content}</span>
              </div>
            );
          
          case 'text':
          default:
            return (
              <div key={item.key} style={{ marginBottom: textMargin, color: '#000000', fontSize: '10pt', lineHeight, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                {item.content}
              </div>
            );
        }
      });
    };
    
    const renderResumeWithTemplate = (text, sectionsInfo = null, isImproved = false, extractedLinks = []) => {
      // For improved resume, use simpler parsing (already structured)
      // For original resume, use enhanced parsing (might be unstructured)
      const sections = isImproved 
        ? parseResumeSectionsSimple(text, sectionsInfo)
        : parseResumeSections(text, sectionsInfo);
      
      // For improved resume, render in PDF-like format (ATS-friendly, no colored boxes)
      if (isImproved) {
        // Filter out sections with no content
        // Specifically exclude PROFESSIONAL EXPERIENCE section if it's empty
        const sectionsWithContent = sections.filter(section => {
          const content = section.content || '';
          const hasContent = content.trim().length > 0;
          // If it's an experience section with no content, exclude it
          if (section.type === 'experience' && !hasContent) {
            return false;
          }
          return hasContent;
        });
        
        return (
          <div
            style={{
              fontFamily: 'Helvetica, Arial, sans-serif',
              color: '#000000',
              background: '#ffffff',
              width: '210mm',
              minHeight: '297mm',
              margin: '0 auto',
              padding: '20mm',
              border: '1px solid #e5e7eb',
              boxShadow: '0 15px 45px rgba(15,23,42,0.08)',
              boxSizing: 'border-box'
            }}
          >
            {sectionsWithContent.map((section, sectionIdx) => {
              const isHeaderSection = section.type === 'header';
              
              if (isHeaderSection) {
                return (
                  <div key={sectionIdx} style={{ marginBottom: '0.8rem' }}>
                    {formatSectionContent(section.content, section.type, true, true, extractedLinks)}
                  </div>
                );
              }
              
              return (
                <div key={sectionIdx} style={{ marginBottom: '0.85rem' }}>
                  {/* Section Header - PDF style: bold, uppercase, underlined */}
                  <div style={{
                    marginBottom: '0.25rem',
                    paddingBottom: '0.08rem',
                    borderBottom: '0.5px solid #000000',
                    marginTop: sectionIdx === 0 ? '0' : '0.7rem'
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '11pt',
                      fontWeight: 700,
                      color: '#000000',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: 'Helvetica, Arial, sans-serif',
                      lineHeight: '1.2'
                    }}>
                      {section.name}
                    </h3>
                  </div>
                  
                  {/* Section Content - Simple white background, black text */}
                  <div style={{
                    padding: 0,
                    background: '#ffffff',
                    marginTop: '0.25rem'
                  }}>
                  {formatSectionContent(section.content, section.type, true, true, extractedLinks)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      
      // For original resume, use colored template
      // Filter out sections with no content
      // Specifically exclude PROFESSIONAL EXPERIENCE section if it's empty
      const sectionsWithContent = sections.filter(section => {
        const content = section.content || '';
        const hasContent = content.trim().length > 0;
        // If it's an experience section with no content, exclude it
        if (section.type === 'experience' && !hasContent) {
          return false;
        }
        return hasContent;
      });
      
      return (
        <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {sectionsWithContent.map((section, sectionIdx) => {
            const sectionColors = {
              header: { bg: '#f0f9ff', border: '#3b82f6', text: '#1e40af' },
              summary: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
              skills: { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
              experience: { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6' },
              education: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
              projects: { bg: '#e0f2fe', border: '#0ea5e9', text: '#0c4a6e' },
              certifications: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
              awards: { bg: '#fce7f3', border: '#ec4899', text: '#9f1239' },
              languages: { bg: '#f3f4f6', border: '#6b7280', text: '#374151' },
              coding: { bg: '#f3f4f6', border: '#6b7280', text: '#374151' },
              links: { bg: '#f3f4f6', border: '#6b7280', text: '#374151' },
              other: { bg: '#f9fafb', border: '#9ca3af', text: '#4b5563' }
            };
            
            const colors = sectionColors[section.type] || sectionColors.other;
            
            return (
              <div key={sectionIdx} style={{ marginBottom: '1.5rem' }}>
                {/* Section Header */}
                <div style={{
                  padding: '0.75rem 1rem',
                  background: colors.bg,
                  borderLeft: `4px solid ${colors.border}`,
                  borderTop: `1px solid ${colors.border}`,
                  borderRight: `1px solid ${colors.border}`,
                  borderTopLeftRadius: '8px',
                  borderTopRightRadius: '8px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: colors.text,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      {section.name}
                    </h3>
                    {section.isNew && (
                      <span style={{
                        padding: '0.125rem 0.5rem',
                        background: '#10b981',
                        color: 'white',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600
                      }}>
                        NEW
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Section Content */}
                <div style={{
                  padding: '1rem 1.25rem',
                  background: 'white',
                  borderLeft: `4px solid ${colors.border}`,
                  borderBottom: `1px solid ${colors.border}`,
                  borderRight: `1px solid ${colors.border}`,
                  borderBottomLeftRadius: '8px',
                  borderBottomRightRadius: '8px',
                  borderTop: 'none'
                }}>
                  {formatSectionContent(section.content, section.type, false, false, extractedLinks)}
                </div>
              </div>
            );
          })}
        </div>
      );
    };
    
    const formatResumeText = (text, sectionsInfo = null, isImproved = false, extractedLinks = []) => {
      // Use template-based rendering
      // Improved resume uses simpler parsing (already structured)
      // Original resume uses enhanced parsing (might be unstructured)
      return renderResumeWithTemplate(text, sectionsInfo, isImproved, extractedLinks);
    };

  const normalizeSkillLabel = (skill) =>
    (skill || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

  const skillIconMap = {
    powerbi: 'https://img.icons8.com/color/512/power-bi.png',
    powerquery: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRXwS_-XDhiQotE4vvhGfapvguiWA45idkXqQ&s',
    dax: 'https://thumbs.dreamstime.com/b/dax-creative-minimalist-letter-logo-unique-vector-initials-alphabet-design-329808513.jpg',
    python: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
    pandas: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/pandas/pandas-original.svg',
    numpy: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/numpy/numpy-original.svg',
    matplotlib: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/matplotlib/matplotlib-original.svg',
    seaborn: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
    sql: 'https://www.mysql.com/common/logos/logo-mysql-170x115.png',
    windowfunctions: 'https://www.mysql.com/common/logos/logo-mysql-170x115.png',
    ctes: 'https://www.mysql.com/common/logos/logo-mysql-170x115.png',
    excel: 'https://mailmeteor.com/logos/assets/PNG/Microsoft_Office_Excel_Logo_512px.png',
    powerapps: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/powerbi/powerbi-original.svg'
  };


  const getSkillIcon = (skill) => {
    const normalizedSkill = normalizeSkillLabel(skill);
    return skillIconMap[normalizedSkill] || null;
  };

  const gapVisualPalettes = [
    {
      gapBg: 'linear-gradient(135deg, #fffafb, #fff5f2)',
      gapBorder: '#ffe4d6',
      moduleBg: 'linear-gradient(135deg, #f8f9ff, #eef2ff)',
      moduleBorder: '#dee3ff',
      glow: 'rgba(251, 146, 60, 0.12)',
      accent: '#c26c37'
    },
    {
      gapBg: 'linear-gradient(135deg, #fffef5, #fcf9e6)',
      gapBorder: '#f5ecc6',
      moduleBg: 'linear-gradient(135deg, #f2fbff, #e8f6ff)',
      moduleBorder: '#d3ecff',
      glow: 'rgba(37, 99, 235, 0.12)',
      accent: '#3a6fd8'
    },
    {
      gapBg: 'linear-gradient(135deg, #f5fff4, #eefcf5)',
      gapBorder: '#dff7e3',
      moduleBg: 'linear-gradient(135deg, #f7f1ff, #efe8ff)',
      moduleBorder: '#e1d8ff',
      glow: 'rgba(147, 51, 234, 0.12)',
      accent: '#3d7f5c'
    }
  ];

  const jobStats = analysisData?.market_stats || {};
  const jobsAnalyzed = jobStats.jobs_analyzed || 0;
  const topMarketSkills = jobStats.top_skills || [];
  const totalMarketSkills = topMarketSkills.length;
  const addedSkillsList = analysisData?.improved?.skills_added || [];
  
  // Helper function to check if an added skill matches a market skill (handles partial matches)
  // Defined early so it can be used in multiple places
  const skillMatches = (addedSkill, marketSkill) => {
    const normalizedAdded = normalizeSkillLabel(addedSkill);
    const normalizedMarket = normalizeSkillLabel(marketSkill);
    
    // Exact match
    if (normalizedAdded === normalizedMarket) return true;
    
    if (normalizedAdded.startsWith(normalizedMarket)) return true;
    
    // Added skill is at the start of market skill (handles edge cases)
    if (normalizedMarket.startsWith(normalizedAdded)) return true;
    
    return false;
  };
  
  // Count how many of the top market skills are missing (using matching logic)
  const originalSkills = analysisData?.original?.has_skills || [];
  const missingTopMarketSkillsCount = topMarketSkills.filter(({ skill }) => {
    return !originalSkills.some(origSkill => skillMatches(origSkill, skill));
  }).length;
  
  // Find which top market skills are missing (for matching with added skills)
  const missingTopMarketSkills = topMarketSkills.filter(({ skill }) => {
    return !originalSkills.some(origSkill => skillMatches(origSkill, skill));
  });
  
  // Find which added skills address the MISSING TOP MARKET SKILLS (not all missing_critical_skills)
  const addedToCoverMarketNeeds = addedSkillsList.filter((skill) => {
    return missingTopMarketSkills.some(({ skill: marketSkill }) => 
      skillMatches(skill, marketSkill)
    );
  });

  const modulesAddressingGaps = analysisData?.learning_comparison?.cn_course_learning?.modules_addressing_gaps || [];
  const curriculumModulesUsed = analysisData?.curriculum_used || [];

    return (
      <div style={{ minHeight: '100vh', background: '#FFFFFF' }}>
        {/* Fonts for results page */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Header */}
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '2rem 1rem' }}>
          <header style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  onClick={startOver}
                  style={{ 
                    background: 'white', 
                    padding: '0.75rem', 
                    borderRadius: '50%', 
                    border: '1px solid #E5E7EB',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'white'; }}
                >
                  <ArrowLeft style={{ width: '20px', height: '20px', color: '#111827' }} />
            </button>
                <div>
                  <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', fontFamily: "Archivo", margin: 0, lineHeight: 1.2 }}>
                    Free AI Resume checker - Job Match score
                  </h1>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  onClick={downloadImprovedResume}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    padding: '0.5rem 1rem', 
                    background: '#FF6B35', 
                    borderRadius: '0.5rem', 
                    border: 'none',
                    boxShadow: '0 2px 4px rgba(255, 107, 53, 0.2)',
                    color: '#FFFFFF', 
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = '#E55A2B'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = '#FF6B35'; }}
                >
                  <Download style={{ width: '18px', height: '18px' }} />
                  Download improved resume
            </button>
              </div>
            </div>
          </header>
          {/* Main Score Section - Matching Figma Design */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            padding: '3rem 0',
            backgroundColor: '#FEF4F1',
          }}>
            {/* Large Main Score - Job Match Score */}
            <div style={{ position: 'relative', width: '200px', height: '200px', marginBottom: '2rem' }}>
              <svg width="200" height="200" style={{ transform: 'rotate(-90deg)' }}>
                {/* Background circle */}
                <circle
                  cx="100"
                  cy="100"
                  r="85"
                  fill="none"
                  stroke="#E5E7EB"
                  strokeWidth="12"
                />
                {/* Progress circle - Orange */}
                <circle
                  cx="100"
                  cy="100"
                  r="85"
                  fill="none"
                  stroke="#FF6B35"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 85}`}
                  strokeDashoffset={`${2 * Math.PI * 85 * (1 - (analysisData?.improved?.job_relevance_score || 78) / 100)}`}
                  style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                />
              </svg>
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '3rem', fontWeight: 800, color: 'black', lineHeight: 1 , fontFamily: "Archivo" }}>
                  {analysisData?.improved?.job_relevance_score || analysisData?.original?.job_relevance_score || 78}%
                </div>
              </div>
            </div>

            {/* Greeting */}
            {(() => {
              const originalHeader = parseHeaderContent(analysisData?.original?.resume_text || '', analysisData?.extracted_links || []);
              const userName = originalHeader?.name?.split(' ')[0] || 'there';
              return (
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111827', margin: 0, fontFamily: "Archivo" }}>
                    Nice to meet you, {userName} 👋
                  </h2>
                  <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', cursor: 'pointer', fontFamily: "Inter", color: '#565D6D' }}>
                    We've analyzed your resume against {analysisData?.market_stats?.jobs_analyzed || '10000+'} relevant job postings.
                  </p>
                  {/* Success message */}
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginTop: '1rem',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#F0FDF4',
                    border: '1px solid #86EFAC',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    color: '#15803D'
                  }}>
                    <CheckCircle size={16} />
                    Your resume was parsed successfully
                  </div>
                </div>
              );
            })()}

            {/* Four Sub-Scores */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(4, 1fr)', 
              gap: '1.5rem', 
              marginTop: '2rem',
              width: '100%',
              maxWidth: '800px'
            }}>
            {[
              {
                label: 'Original Job Match',
                  value: analysisData?.original?.job_relevance_score || 0,
                  color: '#FF6B35'
              },
              {
                label: 'Improved Job Match',
                  value: analysisData?.improved?.job_relevance_score || 0,
                  color: '#10B981'
              },
              {
                  label: 'Original ATS',
                  value: analysisData?.original?.ats_score || 0,
                  color: '#3B82F6'
              },
              {
                  label: 'Improved ATS',
                  value: analysisData?.improved?.ats_score || 0,
                  color: '#F59E0B'
              }
            ].map((stat, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Circular Progress Indicator */}
                  <div style={{ position: 'relative', width: '100px', height: '100px', marginBottom: '0.5rem' }}>
                    <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="#E5E7EB"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={stat.color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 40}`}
                        strokeDashoffset={`${2 * Math.PI * 40 * (1 - stat.value / 100)}`}
                        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                      />
                    </svg>
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', lineHeight: 1, fontFamily: "Archivo" }}>
                        {stat.value}%
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 500, textAlign: 'center', fontFamily: "Inter" }}>
                    {stat.label}
                  </div>
              </div>
            ))}
            </div>
          </div>
        </div>

        {/* Content - All sections displayed vertically */}
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 1rem 2rem' }}>
          {/* Section 1: Resume Comparison */}
          <ResumeComparison 
            analysisData={analysisData}
            fileUrl={fileUrl}
            fileType={fileType}
            formatResumeText={formatResumeText}
          />

          {/* Improvements Summary */}
          <div style={{ marginTop: '2rem', background: 'white', borderRadius: '12px', padding: '2rem', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>What Changed?</h2>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.875rem' }}>
                    We scanned {jobsAnalyzed || '—'} data-analytics job postings to decide which additions matter most.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
                  {[
                    {
                      icon: TrendingUp,
                      label: 'Most demanded skills',
                      value: totalMarketSkills || '—',
                      detail: totalMarketSkills ? 'Skills that kept showing up' : 'No market data available'
                    },
                    {
                      icon: AlertCircle,
                      label: 'Missing in your resume',
                      value: missingTopMarketSkillsCount,
                      detail: missingTopMarketSkillsCount === 0 ? 'You had every top skill' : 'We highlighted these gaps'
                    },
                    {
                      icon: CheckCircle,
                      label: 'Skills we added',
                      value: addedSkillsList.length,
                      detail: addedSkillsList.length ? `${addedToCoverMarketNeeds.length} address missing top skills` : 'All critical skills were already present'
                    },
                    {
                      icon: Zap,
                      label: 'Skills enhanced',
                      value: analysisData?.improved?.skills_enhanced?.length || 0,
                      detail: analysisData?.improved?.skills_enhanced?.length ? 'Existing skills upgraded with advanced features' : 'No skills were enhanced'
                    }
                  ].map((card, idx) => (
                    <div key={idx} style={{ 
                      background: '#f8fafc', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '8px', 
                      padding: '1rem', 
                      display: 'flex', 
                      gap: '1rem', 
                      alignItems: 'center'
                    }}>
                      <div style={{ 
                        background: 'rgba(99, 102, 241, 0.1)', 
                        padding: '0.75rem', 
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <card.icon style={{ width: '32px', height: '32px', color: '#6366F1' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{card.value}</div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', marginTop: '0.25rem' }}>{card.label}</div>
                        <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>{card.detail}</p>
                      </div>
                    </div>
                      ))}
                    </div>

                {totalMarketSkills > 0 && (
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
                        Most demanded skills in those jobs
                      </h3>
                      <span style={{ fontSize: '0.875rem', color: '#6366F1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {missingTopMarketSkillsCount} missing → {addedToCoverMarketNeeds.length} added
                        <span style={{ fontSize: '1rem' }}>→</span>
                      </span>
                  </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                      {topMarketSkills.map((skill, idx) => {
                        const originalSkills = analysisData?.original?.has_skills || [];
                        const enhancedSkills = analysisData?.improved?.skills_enhanced || [];
                        
                        // Check if base skill was in original
                        const alreadyHad = originalSkills.some(origSkill => 
                          skillMatches(origSkill, skill.skill)
                        );

                        // Check if this skill was enhanced (e.g., Excel → Advanced Excel)
                        const wasEnhanced = enhancedSkills.some(enhanced => 
                          enhanced.toLowerCase().includes(skill.skill.toLowerCase())
                        );

                        // Check if any added skill matches this market skill (handles partial matches)
                        const addedNow = !alreadyHad && addedSkillsList.some(addedSkill => 
                          skillMatches(addedSkill, skill.skill)
                        );
                        const statusStyles = alreadyHad && wasEnhanced
                        ? { label: 'Enhanced', bg: '#fef3c7', textColor: '#92400e' }
                        : alreadyHad
                        ? { label: 'Already in resume', bg: '#d1fae5', textColor: '#065f46' }
                        : addedNow
                        ? { label: 'Added now', bg: '#dbeafe', textColor: '#1e40af' }
                        : { label: 'Still recommended', bg: '#fee2e2', textColor: '#991b1b' };
                        
                        const demandColors = {
                          'Critical': { bg: '#dbeafe', text: '#1e40af', darkBg: '#1e40af', darkText: '#dbeafe' },
                          'High': { bg: '#e9d5ff', text: '#6b21a8', darkBg: '#6b21a8', darkText: '#e9d5ff' },
                          'Essential': { bg: '#fed7aa', text: '#9a3412', darkBg: '#9a3412', darkText: '#fed7aa' },
                          'Growing': { bg: '#fef3c7', text: '#854d0e', darkBg: '#854d0e', darkText: '#fef3c7' }
                        };
                        const demandStyle = demandColors[skill.demand] || demandColors['Growing'];

                        return (
                          <div key={idx} style={{ 
                            background: '#f8fafc', 
                            border: '1px solid #e2e8f0', 
                            borderRadius: '8px', 
                            padding: '1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                              <p style={{ margin: 0, fontWeight: 600, color: '#0f172a', fontSize: '0.875rem' }}>{skill.skill}</p>
                              <p style={{ margin: 0, fontWeight: 700, color: '#6366F1', fontSize: '1rem' }}>{skill.percentage}%</p>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <span style={{ 
                                padding: '0.25rem 0.5rem', 
                                borderRadius: '999px', 
                                background: demandStyle.bg, 
                                color: demandStyle.text, 
                                fontSize: '0.75rem', 
                                fontWeight: 600 
                              }}>
                                {skill.demand}
                              </span>
                              <span style={{ 
                                padding: '0.25rem 0.5rem', 
                                borderRadius: '999px', 
                                background: statusStyles.bg, 
                                color: statusStyles.textColor, 
                                fontSize: '0.75rem', 
                                fontWeight: 600 
                              }}>
                                {statusStyles.label}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px solid #e2e8f0', marginTop: '1.5rem', paddingTop: '1.5rem' }}>
                  {/* Skills Added Section */}
                  {analysisData.improved.skills_enhanced?.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ 
                      fontSize: '1rem', 
                      fontWeight: 600, 
                      marginBottom: '1rem', 
                      color: '#0f172a', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem' 
                    }}>
                      <TrendingUp style={{ width: '20px', height: '20px', color: '#f59e0b' }} />
                      Skills Enhanced
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                      {analysisData.improved.skills_enhanced.map((skill, idx) => (
                        <div key={idx} style={{
                          border: '1px solid #fef3c7',
                          borderRadius: '8px',
                          padding: '0.75rem',
                          display: 'flex',
                          gap: '0.75rem',
                          alignItems: 'center',
                          background: '#fffbeb'
                        }}>
                          <TrendingUp style={{ width: '24px', height: '24px', color: '#f59e0b' }} />
                          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#92400e' }}>{skill}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Skills Added Section (completely new) */}
                {analysisData.improved.skills_added?.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ 
                      fontSize: '1rem', 
                      fontWeight: 600, 
                      marginBottom: '1rem', 
                      color: '#0f172a', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem' 
                    }}>
                      <CheckCircle style={{ width: '20px', height: '20px', color: '#10b981' }} />
                      Skills Added
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                      {analysisData.improved.skills_added.map((skill, idx) => {
                        const icon = getSkillIcon(skill);
                        return (
                          <div key={idx} style={{
                            border: '1px solid #d1fae5',
                            borderRadius: '8px',
                            padding: '0.75rem',
                            display: 'flex',
                            gap: '0.75rem',
                            alignItems: 'center',
                            background: '#ecfdf5'
                          }}>
                            {icon ? (
                              <img src={icon} alt={`${skill} icon`} style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                            ) : (
                              <CheckCircle style={{ width: '24px', height: '24px', color: '#10b981' }} />
                            )}
                            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#065f46' }}>{skill}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                  {/* Projects Added Section */}
                  <div>
                    <h3 style={{ 
                      fontSize: '1rem', 
                      fontWeight: 600, 
                      marginBottom: '1rem', 
                      color: '#0f172a', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem' 
                    }}>
                      <Briefcase style={{ width: '20px', height: '20px', color: '#6366F1' }} />
                      Projects Added
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                      {analysisData.improved.projects_added.map((project, idx) => (
                        <div key={idx} style={{ 
                          border: '1px solid #e2e8f0', 
                          borderRadius: '8px', 
                          padding: '1rem', 
                          display: 'flex', 
                          gap: '1rem', 
                          alignItems: 'center', 
                          background: '#f8fafc'
                        }}>
                          <div style={{ 
                            background: 'rgba(99, 102, 241, 0.1)', 
                            padding: '0.75rem', 
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <Briefcase style={{ width: '20px', height: '20px', color: '#6366F1' }} />
                          </div>
                          <div>
                            <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{project}</p>
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>Added to showcase experience</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

          {/* Section 2: Learning Journey */}
          <div style={{ marginBottom: '3rem' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem', textAlign: 'center', color: '#1f2937' }}>Your Path to Becoming Job-Ready</h2>
                <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '1.125rem', marginBottom: '2rem' }}>See how Coding Ninjas accelerates your learning journey</p>

                {/* Interactive Chart.js Chart */}
                <div style={{ position: 'relative', height: '450px', marginBottom: '3rem', padding: '1rem' }}>
                  <LearningJourneyChart learningComparison={analysisData.learning_comparison} />
                </div>

                {/* Gap Addressing */}
                <div style={{ background: 'linear-gradient(135deg, #fdfbff, #f4f7ff)', borderRadius: '26px', padding: '3rem', marginBottom: '3rem', boxShadow: '0 35px 60px rgba(79,70,229,0.12)', border: '1px solid rgba(191, 197, 255, 0.4)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', width: '220px', height: '220px', borderRadius: '50%', background: 'rgba(129,140,248,0.1)', top: '-80px', right: '-60px', filter: 'blur(14px)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center', marginBottom: '2rem', position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'linear-gradient(135deg, #a855f7, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 25px 40px rgba(124,58,237,0.45)' }}>
                        <Target style={{ width: '28px', height: '28px', color: '#fff' }} />
                          </div>
                        <div>
                        <h3 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#2f0f55', margin: 0 }}>How Coding Ninjas Fills Your Resume Gaps</h3>
                        <p style={{ margin: '0.3rem 0 0', color: '#5b21b6', fontWeight: 600, fontSize: '1rem' }}>Every gap mapped to a curriculum sprint</p>
                          </div>
                        </div>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      {[
                        { label: 'Critical gaps covered', value: modulesAddressingGaps.length || 0 },
                        { label: 'Modules tapped', value: curriculumModulesUsed.length || 0 },
                        { label: 'New skills added', value: addedSkillsList.length || 0 }
                ].map((stat, idx) => (
                        <div key={idx} style={{ padding: '0.9rem 1.1rem', background: 'rgba(255,255,255,0.75)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.8)', minWidth: '160px', boxShadow: '0 10px 20px rgba(15,23,42,0.08)' }}>
                          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#312e81' }}>{stat.value}</div>
                          <div style={{ fontSize: '0.85rem', color: '#4c1d95', fontWeight: 600 }}>{stat.label}</div>
                  </div>
                ))}
              </div>
                        </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', position: 'relative' }}>
                    {modulesAddressingGaps.map((item, idx) => {
                      const palette = gapVisualPalettes[idx % gapVisualPalettes.length];
                      return (
                        <div key={idx} style={{ position: 'relative', background: '#ffffff', borderRadius: '24px', padding: '2rem', boxShadow: '0 24px 40px rgba(15,23,42,0.12)', border: `1px solid ${palette.gapBorder}`, display: 'flex', flexDirection: 'column', gap: '1.5rem', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', width: '180px', height: '180px', borderRadius: '50%', background: palette.glow, top: '-60px', right: '-30px', filter: 'blur(16px)' }} />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', position: 'relative' }}>
                            <div style={{ flex: 1, background: palette.gapBg, borderRadius: '18px', padding: '1.1rem 1.25rem', border: `1px dashed ${palette.gapBorder}` }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.8rem', borderRadius: '999px', background: 'rgba(255,255,255,0.7)', color: palette.accent, fontWeight: 700, fontSize: '0.78rem', marginBottom: '0.45rem' }}>
                                <AlertCircle style={{ width: '16px', height: '16px' }} />
                                Gap detected
                              </span>
                              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>{item.gap}</div>
                      </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ padding: '0.3rem 0.75rem', borderRadius: '999px', background: '#ede9fe', color: '#5b21b6', fontWeight: 700, fontSize: '0.75rem' }}>Sprint {idx + 1}</span>
                              <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'linear-gradient(135deg, #c7d2fe, #a5b4fc)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#312e81', fontWeight: 800, fontSize: '1.2rem' }}>→</div>
                      </div>
                    </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', position: 'relative' }}>
                            <div style={{ background: palette.moduleBg, borderRadius: '18px', padding: '1.25rem', border: `1px solid ${palette.moduleBorder}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
                                <span style={{ fontSize: '0.82rem', color: '#312e81', fontWeight: 700 }}>CN fix deployed</span>
                                <span style={{ padding: '0.3rem 0.8rem', borderRadius: '999px', background: '#ffffff', border: '1px solid rgba(49,46,129,0.15)', fontWeight: 700, fontSize: '0.75rem', color: '#312e81' }}>{item.timeline}</span>
                </div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e1b4b' }}>{item.module}</div>
                    </div>
                            <div style={{ background: '#f8fafc', borderRadius: '18px', padding: '1.15rem', border: '1px solid #e2e8f0' }}>
                              <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: '#475569', marginBottom: '0.4rem' }}>Impact on resume</div>
                              <p style={{ margin: 0, color: '#0f172a', fontSize: '0.95rem', lineHeight: 1.65 }}>
                                {item.description}
                              </p>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.85rem', padding: '0.4rem 0.85rem', borderRadius: '999px', background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: '0.8rem' }}>
                                <CheckCircle style={{ width: '16px', height: '16px' }} />
                                Skill gap closed
                    </div>
                  </div>
                </div>
              </div>
                      );
                    })}
                  </div>
                </div>
                      </div>
                        </div>
        </div>
    );
  }

  return null;
};

export default ResumeAnalyzer;