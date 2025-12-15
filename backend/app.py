"""
AI Resume Analyzer Backend - Flask API
Analyzes Data Analytics resumes and improves them using Coding Ninjas curriculum
UPDATED: Uses three pre-filtered JSON files (fresher, intermediate, experienced)
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import dotenv_values
from datetime import datetime
import io
import json
import re
import os
from collections import Counter
from openai import OpenAI
import fitz  # PyMuPDF
import docx
from datetime import datetime
from pathlib import Path
import time

# Load environment variables from .env file (if exists) or from environment
config = dotenv_values('.env')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize OpenAI client - use environment variable if .env file doesn't have it
openai_api_key = config.get('OPENAI_API_KEY') or os.getenv('OPENAI_API_KEY')
client = OpenAI(api_key=openai_api_key)

# Debug logging configuration (agent instrumentation)
DEBUG_LOG_PATH = Path(__file__).parent.parent / '.cursor' / 'debug.log'

# Load curriculum from JSON file
def load_curriculum():
    """Load curriculum from JSON file and return formatted text for prompts"""
    curriculum_file = Path(__file__).parent.parent / 'data-analytics-curriculum.json'
    try:
        with open(curriculum_file, 'r', encoding='utf-8') as f:
            curriculum_data = json.load(f)
        
        # Format curriculum for prompt
        formatted_parts = []
        formatted_parts.append("# Coding Ninjas Data Analytics Course Curriculum\n")
        
        for module in curriculum_data.get('curriculum', []):
            module_name = module.get('module', '')
            topics = module.get('topics', [])
            case_studies = module.get('caseStudies', [])
            
            formatted_parts.append(f"## {module_name}")
            formatted_parts.append("\n### Topics Covered:")
            for topic in topics:
                formatted_parts.append(f"- {topic}")
            
            if case_studies:
                formatted_parts.append("\n### Case Studies:")
                for case in case_studies:
                    formatted_parts.append(f"- {case}")
            
            formatted_parts.append("")  # Empty line between modules
        
        return "\n".join(formatted_parts)
    except FileNotFoundError:
        return "Curriculum file not available"
    except Exception as e:
        print(f"Error loading curriculum: {e}")
        return "Curriculum file not available"

# Load curriculum text for use in prompts
curriculum_text = load_curriculum()

# Focused curriculum skills list to keep skill filtering lightweight
CURRICULUM_SKILLS_FOCUS = [
    "Excel", "Power BI", "SQL", "MySQL", "Python", "NumPy", "Pandas",
    "Matplotlib", "Seaborn", "Statistics", "EDA", "Power Query", "DAX",
    "Generative AI"
]


def agent_debug_log(hypothesis_id: str, location: str, message: str, data=None, run_id: str = "pre-fix"):
    """
    Append a single NDJSON log line for debugging hypotheses.
    """
    payload = {
        "sessionId": "debug-session",
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(time.time() * 1000)
    }
    try:
        with open(DEBUG_LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        # Debug logging failures should never break main flow
        pass

# ============================================================================
# LOAD PRE-FILTERED JOB DATA (Three JSON files)
# ============================================================================

def load_base_prompt() -> str:
    """Load the base prompt from the prompts directory."""
    prompt_path = Path(__file__).parent / "prompts" / "template.txt"
    with open(prompt_path, "r") as f:
        return f.read()

def load_scoring_prompt() -> str:
    """Load the scoring prompt from the prompts directory."""
    prompt_path = Path(__file__).parent / "prompts" / "scoring_guidelines.txt"
    with open(prompt_path, "r") as f:
        return f.read()

SCORING_GUIDELINES = load_scoring_prompt()
MARKET_INSIGHTS = None

# ============================================================================
# LOAD PRE-ANALYZED MARKET DATA (Three JSON files)
# ============================================================================

def load_analysis_by_level():
    """
    Load pre-analyzed market data from three JSON files in the Analysis folder.
    Returns a dictionary with keys: 'fresher', 'intermediate', 'experienced'
    """
    try:
        base_path = Path(__file__).parent.parent
        analysis_path = base_path / 'Analysis'
        
        with open(analysis_path / 'fresher.json', 'r', encoding='utf-8') as f:
            fresher_analysis = json.load(f)
        
        with open(analysis_path / 'intermediate.json', 'r', encoding='utf-8') as f:
            intermediate_analysis = json.load(f)
        
        with open(analysis_path / 'experienced.json', 'r', encoding='utf-8') as f:
            experienced_analysis = json.load(f)
        
        print(f"Loaded analysis data by level:")
        print(f"- Fresher: ✓")
        print(f"- Intermediate: ✓")
        print(f"- Experienced: ✓")
        
        return {
            'fresher': fresher_analysis,
            'intermediate': intermediate_analysis,
            'experienced': experienced_analysis
        }
    except FileNotFoundError as e:
        print(f"Error loading analysis data: {e}")
        print("Make sure these files exist in the Analysis folder:")
        print("- Analysis/fresher.json")
        print("- Analysis/intermediate.json")
        print("- Analysis/experienced.json")
        return None
    except Exception as e:
        print(f"Error loading analysis data: {e}")
        return None

# Load analysis data at startup
ANALYSIS_BY_LEVEL = load_analysis_by_level()

# Store extract-text response in memory for use in step 3
EXTRACT_TEXT_DATA = {}

# ============================================================================
# HELPER FUNCTIONS - Document Processing
# ============================================================================

def extract_text_from_pdf(file_stream):
    """
    Extract text AND embedded hyperlinks from a PDF.
    Returns: {"text": str, "links": [{"url": ..., "text": ...}, ...]}
    """
    try:
        pdf_bytes = file_stream.read()
        file_stream.seek(0)
        pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
        text_parts = []
        links = []
        
        for page_num in range(len(pdf_document)):
            page = pdf_document[page_num]
            
            # -------- Text Extraction (existing behavior) --------
            text_dict = page.get_text("dict")
            blocks = []
            for block in text_dict.get("blocks", []):
                if "lines" in block:
                    for line in block["lines"]:
                        line_text = ""
                        for span in line.get("spans", []):
                            span_text = span.get("text", "").strip()
                            if span_text:
                                line_text += span_text + " "
                        if line_text.strip():
                            blocks.append(line_text.strip())
            page_text = "\n".join(blocks)
            if page_text:
                text_parts.append(page_text)
            
            # -------- Link Extraction --------
            for link in page.get_links():
                uri = link.get("uri")
                if not uri:
                    continue
                # Restrict to relevant domains/types
                lower_uri = uri.lower()
                if not (
                    "linkedin.com" in lower_uri
                    or "github.com" in lower_uri
                    or "kaggle.com" in lower_uri
                    or lower_uri.startswith("mailto:")
                ):
                    # Also allow generic project links if https present
                    if not lower_uri.startswith("http"):
                        continue
                anchor_text = ""
                if link.get("from"):
                    try:
                        anchor_text = page.get_text("text", clip=link["from"]).strip()
                    except Exception:
                        anchor_text = ""
                links.append({
                    "url": uri,
                    "text": anchor_text
                })
        
        pdf_document.close()
        return {
            "text": "\n".join(text_parts).strip(),
            "links": links
        }
    except Exception as e:
        raise Exception(f"Error reading PDF: {str(e)}")


def extract_text_from_docx(file_stream):
    """Extract text from DOCX file"""
    try:
        doc = docx.Document(file_stream)
        text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
        return text
    except Exception as e:
        raise Exception(f"Error reading DOCX: {str(e)}")


def extract_text_from_txt(file_stream):
    """Extract text from TXT file"""
    try:
        return file_stream.read().decode('utf-8')
    except Exception as e:
        raise Exception(f"Error reading TXT: {str(e)}")


# ============================================================================
# HELPER FUNCTIONS - Analysis Data Formatting
# ============================================================================

def format_analysis_for_prompt(analysis_data):
    """
    Format the pre-analyzed market data into a format suitable for the LLM prompt.
    Converts the simplified analysis JSON structure into formatted text.
    """
    if not analysis_data:
        return "Analysis data not available."
    
    formatted_text = []
    
    # Add total jobs analyzed
    if 'total_jobs_analyzed' in analysis_data:
        formatted_text.append(f"Total Jobs Analyzed: {analysis_data['total_jobs_analyzed']}")
    
    # Format most demanded skills
    if 'most_demanded_skills' in analysis_data:
        formatted_text.append("\n## Most Demanded Skills:")
        skills_dict = analysis_data['most_demanded_skills']
        # Sort by percentage (descending)
        sorted_skills = sorted(skills_dict.items(), key=lambda x: float(x[1].rstrip('%')), reverse=True)
        for skill, percentage in sorted_skills[:20]:  # Top 20 skills
            # Normalize percentage format
            pct_str = percentage if '%' in percentage else f"{percentage}%"
            # Determine demand level based on percentage
            pct = float(percentage.rstrip('%'))
            if pct >= 60:
                demand = "Critical"
            elif pct >= 40:
                demand = "High"
            elif pct >= 20:
                demand = "Essential"
            else:
                demand = "Growing"
            formatted_text.append(f"- {skill} (appears in {pct_str}) - Demand: {demand}")
    
    # Format soft skills
    if 'soft_skills' in analysis_data:
        formatted_text.append("\n## Soft Skills:")
        soft_skills_dict = analysis_data['soft_skills']
        sorted_soft = sorted(soft_skills_dict.items(), key=lambda x: float(x[1].rstrip('%')), reverse=True)
        for skill, percentage in sorted_soft[:15]:  # Top 15 soft skills
            # Normalize percentage format
            pct_str = percentage if '%' in percentage else f"{percentage}%"
            formatted_text.append(f"- {skill} ({pct_str})")
    
    # Format roles
    if 'roles' in analysis_data:
        formatted_text.append("\n## Common Job Titles:")
        roles_dict = analysis_data['roles']
        sorted_roles = sorted(roles_dict.items(), key=lambda x: float(x[1].rstrip('%')), reverse=True)
        for role, percentage in sorted_roles[:15]:  # Top 15 roles
            # Normalize percentage format
            pct_str = percentage if '%' in percentage else f"{percentage}%"
            formatted_text.append(f"- {role} ({pct_str})")
    
    # Format educational background
    if 'educational_background' in analysis_data:
        formatted_text.append("\n## Educational Background:")
        edu_dict = analysis_data['educational_background']
        sorted_edu = sorted(edu_dict.items(), key=lambda x: float(x[1].rstrip('%')), reverse=True)
        for edu, percentage in sorted_edu[:15]:  # Top 15 educational backgrounds
            # Normalize percentage format
            pct_str = percentage if '%' in percentage else f"{percentage}%"
            formatted_text.append(f"- {edu} ({pct_str})")
    
    return "\n".join(formatted_text)


# ============================================================================
# STEP 2: Analyze Resume + Determine Data Analytics Level (AI Call #1)
# ============================================================================

def analyze_original_resume(resume_text, analysis_dict):
    """
    Two-call prompt chain for step 2.
    Call 1: Gap analysis (level, skills, projects).
    Call 2: Assessment & scoring using Call 1 output.
    """

    def _top_skills_by_level(analysis_data, top_n=10):
        """Builds top skills list with percentages per level."""
        if not analysis_data:
            return []
        skills = analysis_data.get("most_demanded_skills", {})
        sorted_skills = sorted(
            skills.items(),
            key=lambda x: float(str(x[1]).rstrip("%") or 0),
            reverse=True
        )
        result = []
        for skill, pct in sorted_skills[:top_n]:
            pct_str = pct if isinstance(pct, str) and "%" in pct else f"{pct}%"
            demand = "Critical" if float(str(pct).rstrip("%") or 0) >= 60 else (
                "High" if float(str(pct).rstrip("%") or 0) >= 40 else (
                    "Essential" if float(str(pct).rstrip("%") or 0) >= 20 else "Growing"
                )
            )
            result.append(f"{skill} (appears in {pct_str}) - Demand: {demand}")
        return result

    fresher_top_skills = _top_skills_by_level(analysis_dict.get("fresher"))
    intermediate_top_skills = _top_skills_by_level(analysis_dict.get("intermediate"))
    experienced_top_skills = _top_skills_by_level(analysis_dict.get("experienced"))

    fresher_analysis_formatted = format_analysis_for_prompt(analysis_dict.get('fresher'))
    intermediate_analysis_formatted = format_analysis_for_prompt(analysis_dict.get('intermediate'))
    experienced_analysis_formatted = format_analysis_for_prompt(analysis_dict.get('experienced'))

    # region agent log (pre-call 1)
    agent_debug_log(
        hypothesis_id="H1",
        location="backend/app.py:LLM1:pre-call",
        message="LLM1 pre-call state",
        data={
            "resume_chars": len(resume_text or ""),
            "has_fresher": bool(analysis_dict.get('fresher')),
            "has_intermediate": bool(analysis_dict.get('intermediate')),
            "has_experienced": bool(analysis_dict.get('experienced'))
        }
    )
    # endregion

    # -----------------------
    # CALL 1: Gap Analysis
    # -----------------------
    system_message_gap = """
# Role
You are a Data Analytics resume gap analyzer.

# Task
Analyze the resume and identify what the candidate has vs what they need.

# Instructions (3 steps only)
## Step 1: Determine Experience Level
- Calculate DA work duration from explicit dates only.
- user_level rules:
  - ≤1.00 years -> Fresher
  - 1.00-3.00 years -> Intermediate
  - >3.00 years -> Experienced
## Step 2: Analyze Skills
- Extract and normalize all technical skills -> has_skills.
- Compare against provided market top 10 for the detected level.
- missing_skills = market top 10 NOT in has_skills.
- Filter missing_skills to only those in CURRICULUM_SKILLS.
## Step 3: Evaluate Projects
- List projects found.
- Mark projects irrelevant if they lack DA tools/tech or are off-domain.

# Output (JSON only)
{
  "user_level": "...",
  "experience_reasoning": "...",
  "skills_analysis": {
    "has_skills": [],
    "missing_skills": []
  },
  "projects_analysis": {
    "projects_to_keep": [],
    "projects_to_remove": []
  }
}
"""

    user_prompt_gap = f"""
Resume:
{resume_text}

Market Top 10 Skills by Level (use only detected level):
- Fresher: {fresher_top_skills}
- Intermediate: {intermediate_top_skills}
- Experienced: {experienced_top_skills}

CURRICULUM_SKILLS = {CURRICULUM_SKILLS_FOCUS}

Note: Use exact skills from resume for has_skills; never add unmentioned skills. Only keep missing_skills that are also in CURRICULUM_SKILLS.
"""

    response_gap = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message_gap},
            {"role": "user", "content": user_prompt_gap}
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
        max_tokens=800
    )
    gap_analysis = json.loads(response_gap.choices[0].message.content)

    # region agent log (post-call1)
    agent_debug_log(
        hypothesis_id="H2",
        location="backend/app.py:LLM1:post-call",
        message="LLM1 post-call received",
        data={
            "user_level": gap_analysis.get("user_level"),
            "has_missing": len(gap_analysis.get("skills_analysis", {}).get("missing_skills", []))
        }
    )
    # endregion

    # ----------------------------
    # CALL 2: Assessment & Scoring
    # ----------------------------
    system_message_assess = """
# Role
You are a Data Analytics resume evaluator and ATS expert.

# Task
Evaluate resume quality and calculate scores using the gap analysis context.

# Instructions (3 steps only)
## Step 1: Keyword Analysis
- Check keyword presence vs provided market data (detected level).
## Step 2: ATS Compatibility
- Assess structure/format for ATS friendliness.
## Step 3: Calculate Scores
- Apply provided scoring guidelines to output job relevance and ATS scores.

# Output (JSON only)
{
  "keywords_analysis": {"present_keywords": [], "missing_keywords": []},
  "ats_analysis": {"reasoning": "1-2 sentence max"},
  "scores": {"job_relevance_score": 0, "ats_score": 0, "score_reasoning": "1-2 sentence max"},
  "job_market_analysis": {
    "jobs_analyzed": <integer from market data or 0>,
    "top_skills": ["Skill (appears in X%) - Demand: ..."]
  },
  "analysis_summary": "1-2 sentence max"
}
"""

    # choose market data for detected level
    detected_level = (gap_analysis.get("user_level") or "fresher").lower()
    level_key = "fresher" if "fresh" in detected_level else (
        "intermediate" if "inter" in detected_level else "experienced"
    )
    level_analysis = analysis_dict.get(level_key, {})
    level_top_skills = _top_skills_by_level(level_analysis)
    jobs_analyzed = level_analysis.get("total_jobs_analyzed", 0)

    user_prompt_assess = f"""
Resume:
{resume_text}

Gap Analysis (from Call 1):
{json.dumps(gap_analysis, indent=2)}

Market data (detected level: {level_key}):
- jobs_analyzed: {jobs_analyzed}
- top_skills: {level_top_skills}

Scoring Guidelines:
{SCORING_GUIDELINES}
"""

    response_assess = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message_assess},
            {"role": "user", "content": user_prompt_assess}
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=900
    )
    assessment = json.loads(response_assess.choices[0].message.content)

    # Merge outputs
    analysis = {**gap_analysis, **assessment}

    # Defensive defaults
    if 'job_market_analysis' not in analysis:
        analysis['job_market_analysis'] = {
            "jobs_analyzed": jobs_analyzed,
            "top_skills": level_top_skills
        }

    # Cleanup unwanted fields if any
    unwanted_fields = ['_metadata', 'keyword_density_score', 'skill_match_percentage',
                       'jobs_analyzed_at_level', 'total_jobs_by_level', 'jobs_sent_to_llm']
    for field in unwanted_fields:
        analysis.pop(field, None)
    if 'scores' in analysis:
        analysis['scores'].pop('skill_match_percentage', None)
    if 'keywords_analysis' in analysis:
        analysis['keywords_analysis'].pop('keyword_density_score', None)
    if 'job_market_analysis' in analysis:
        analysis['job_market_analysis'].pop('jobs_analyzed_at_level', None)

    user_level = analysis.get('user_level', 'Unknown')
    print("Analysis complete:")
    print(f"  - User level: {user_level}")

    return analysis

# ============================================================================
# STEP 3: Generate Improved Resume + Curriculum Mapping (AI Call #2)
# ============================================================================
CURRENT_YEAR = datetime.now().year + 1

def generate_improved_resume(resume_data, gap_analysis, curriculum_text):
    """
    Generate improved resume using resume data (text and links), Step 2 analysis, and Coding Ninjas curriculum.
    
    Args:
        resume_data: Dictionary containing 'text' (resume text string) and 'links' (array of link objects with text and url)
        gap_analysis: Complete Step 2 analysis JSON (from full_analysis)
        curriculum_text: Coding Ninjas curriculum content
    """
    
    
    if not gap_analysis:
        raise ValueError("Step 2 analysis is required")
    
    system_message = """
# Role
You are an expert resume writer specializing in Data Analytics roles with deep knowledge of Coding Ninjas curriculum.

# Task
Generate an improved ATS-friendly Data Analytics resume using gap analysis insights and curriculum modules.

# Instructions (4 clear steps)

## Step 1: Skill Enhancement & Addition Strategy
Using the gap_analysis and curriculum provided:

### 1a. Identify Skills to Enhance
- Check each skill in gap_analysis.skills_analysis.has_skills
- For each skill, check if curriculum offers advanced topics
- Examples:
  - has "Excel" → can enhance with "Power Query" from curriculum
  - has "SQL" → can enhance with "CTEs, Window Functions" from curriculum
  - has "Python" → can enhance with "NumPy, Pandas, Matplotlib" from curriculum
- Output: skills_to_enhance = [{"base": "Excel", "enhanced": "Advanced Excel (Power Query)", "module": "Introduction to Data Analytics and Excel"}]

### 1b. Identify Skills to Add
- Use gap_analysis.skills_analysis.missing_skills (already filtered to curriculum)
- Map each missing skill to its curriculum module
- Output: skills_to_add = [{"skill": "Power BI", "module": "Data Visualization with PowerBi"}]

### 1c. Break Down Missing Keywords into Specifics
- Use gap_analysis.keywords_analysis.missing_keywords
- For each keyword, identify specific sub-skills from curriculum:
  - "SQL" → "CTEs (Common Table Expressions), Window Functions"
  - "Python" → "NumPy, Pandas, Matplotlib, Seaborn"
  - "Power BI" → "DAX, Power Query, Data Modeling"
  - "Excel" → "Power Query, Advanced Functions, Data Cleaning"
- Output: keyword_specifics = [{"keyword": "SQL", "specifics": ["CTEs", "Window Functions"], "module": "Analytics with SQL"}]

## Step 2: Project Strategy
Using gap_analysis.projects_analysis:

### 2a. Remove Irrelevant Projects
- Remove all projects listed in projects_to_remove
- These are non-DA projects that add no value

### 2b. Add Curriculum Case Studies as Projects
- Add case studies from curriculum modules that (equivalent to the length of gap_analysis.projects_analysis.projects_to_remove field):
  - Support skills being added/enhanced
  - Are most relevant to user_level (Fresher/Intermediate/Experienced)
- For each case study, create a project entry:
  - Project Name: Use case study name
  - Technologies: List relevant skills from that module
  - Description: 2-3 sentences about what analysis was done
- Output: projects_to_add = [{"name": "US Healthcare Dataset Analysis", "module": "Introduction to Data Analytics and Excel", "technologies": ["Excel", "Power Query"], "description": "..."}]

### 2c. Keep Relevant Projects
- Retain all projects from projects_to_keep with original description
- These are existing DA-relevant projects

### Final Project List
- New projects to be added is equivalent to the length of projects_to_remove field
- Order: Most relevant to DA first
- Balance: User's existing projects + curriculum case studies

## Step 3: Generate Improved Resume Text
Follow this ATS-friendly structure:

**CRITICAL**: While generating the improved resume text, if you think the original content or sections are good enough and don't require any enhancement, just keep it as it is.

### Header Section
[FULL NAME IN CAPS]
Email | Phone | Location | LinkedIn | GitHub 
(Only use the contact info present in the original resume and embedded links, remove the contact info that is not present in the original resume)

### Professional Summary
2 sentences maximum: [Professional Title based on user_level] with expertise in [top 2-4 skills including enhanced ones], experienced in [domain/projects], seeking to leverage [skills] for [DA role type].

### Technical Skills
Group into categories, display ONLY final enhanced versions (NO arrows):
• **Programming & Languages:** [enhanced skills + new skills]
• **Data Visualization Tools:** [Power BI, Excel, etc.]
• **Databases:** [SQL, MySQL, etc.]
• **Python Libraries:** [NumPy, Pandas, Matplotlib, Seaborn]
• **Other Tools:** [relevant tools]

**CRITICAL:** In resume text, show "Advanced Excel (Power Query)" NOT "Excel → Advanced Excel"

### Professional Experience / Work Experience
**MANDATORY RULES:**
- Include this section ONLY if ALL three conditions are met:
  1. user_level is NOT "Fresher" (must be "Intermediate" or "Experienced")
  2. Original resume has work experience section with dates
  3. Work experience is relevant to Data Analytics field or Techinal field like Software Development, etc.
  
- If user_level = "Fresher" → SKIP this entire section completely
- If work experience exists but not DA-related → SKIP this entire section completely
- When included: [Retain original descriptions, enhance with keywords if needed, keep original metrics]

### Education
**MANDATORY:** Use exact section name "Education" (NOT "Academic Details")
[Retain original education details exactly as provided]

### Projects
[Final project list from Step 2c]
For original projects:
- retain all the original details: project name, description, project links, duration
For curriculum case studies:
[Project Name] [Link to the project if present]
- Bullet points description (3 points) highlighting analysis, Technologies & Techniques used, outcomes

### Certifications
[Keep all original certifications]
ONLY ADD If certification with name Data Analytics doesn't exists:
- Certification in Data Analytics | Coding Ninjas | {CURRENT_YEAR}

### Sections other than the above sections should be removed

## Step 4: Classification & Tracking

### Pre-Check (MANDATORY)
Before classification, verify what exists in original resume:
- original_has_skills = gap_analysis.skills_analysis.has_skills
- A skill can ONLY be "enhanced" if its base form is in original_has_skills

### Classification Rules
1. **skills_enhanced:** Skills whose BASE form exists in original_has_skills
   - Format: ["Excel → Advanced Excel (Power Query)"]
   - ONLY if "Excel" is in original_has_skills
   
2. **skills_added:** Skills whose BASE form is NOT in original_has_skills
   - Format: ["Power BI", "Python"]
   - If original_has_skills = ["Excel", "SQL"], then Python goes here

3. **For Fresher with Zero Analytics Skills:**
   - If original_has_skills = [] or only has non-analytics skills
   - Then skills_added gets ALL curriculum skills
   - skills_enhanced remains EMPTY

**MANDATORY RULE:** A skill can ONLY appear in ONE array:
- Either skills_enhanced (if base exists and you're showing enhancement)
- OR skills_added (if it's a new standalone skill)
- NEVER in both  

**For Python libraries specifically:**
- Original has "Python" but NOT "NumPy, Pandas"
- These libraries should go to skills_enhanced ONLY

### Module Tracking
For each module used:
- module: Exact name from curriculum
- addresses_gaps: List specific skills/keywords it addresses
- projects_included: List case studies used as projects
- skills_added_from_module: New skills from this module
- skills_enhanced_by_module: Enhanced skills using this module

# Output Format (JSON only)
{
  "skill_strategy": {
    "skills_to_enhance": [
      {"base": "Excel", "enhanced": "Advanced Excel (Power Query)", "module": "..."}
    ],
    "skills_to_add": [
      {"skill": "Power BI", "module": "..."}
    ],
    "keyword_specifics": [
      {"keyword": "SQL", "specifics": ["CTEs", "Window Functions"], "module": "..."}
    ]
  },
  
  "project_strategy": {
    "projects_removed": ["project name"],
    "projects_kept": ["project name"],
    "projects_added": [
      {
        "name": "Case Study Name",
        "module": "...",
        "technologies": [],
        "description": "..."
      }
    ],
    "final_project_count": 3
  },
  
  "curriculum_mapping": {
    "modules_used": [
      {
        "module": "Exact module name",
        "addresses_gaps": ["skill1", "skill2"],
        "projects_included": ["case study name"],
        "skills_added_from_module": ["skill1"],
        "skills_enhanced_by_module": ["base → enhanced"]
      }
    ]
  },
  
  "improved_resume": {
    "improved_text": "Complete resume text following template structure. CRITICAL: Use 'Education' section name (NOT 'Academic Details'). For Freshers, SKIP 'Professional Experience' section entirely. In TECHNICAL SKILLS, show 'Advanced Excel (Power Query)' NOT 'Excel → Advanced Excel'",
    "skills_added": ["Power BI", "Python"],
    "skills_enhanced": ["Excel → Advanced Excel (Power Query)", "SQL → Advanced SQL (CTEs, Window Functions)", "Python → Python (NumPy, Pandas)"],
    "projects_added": ["case study name"],
    "job_relevance_score": <0-100 integer>,
    "ats_score": <0-100 integer>,
    "estimated_improvement": <0-100 integer>
  },
  
  "modification_summary": "Enhanced [X] existing skills with [specific topics], added [Y] new skills from curriculum, replaced [Z] irrelevant projects with [curriculum case studies], improving job relevance by [%]."
}

# Critical Guidelines
- NEVER add metrics not in original resume
- NEVER invent work experience
- MUST verify base skill exists before marking as "enhanced"
- skill_enhanced & skill_added have unique skills in their respective arrays
- MUST use only curriculum skills/projects
- MUST preserve all original dates, education, contact info, metrics
- NO arrow notation (→) in resume text, ONLY in JSON tracking fields
- ALWAYS use "Education" as section name (NOT "Academic Details" or any other variant)
- For Freshers (user_level = "Fresher"), SKIP Professional Experience section completely
"""

    # Extract text and links from resume_data for clarity
    resume_text_content = resume_data.get('text', '')
    resume_links = resume_data.get('links', [])

    # region agent log
    agent_debug_log(
        hypothesis_id="H3",
        location="backend/app.py:LLM2:pre-call",
        message="LLM2 pre-call state",
        data={
            "resume_chars": len(resume_data.get('text', '') or ""),
            "links_count": len(resume_data.get('links', []) or []),
            "missing_skills": len(gap_analysis.get('skills_analysis', {}).get('missing_skills', []) if gap_analysis else 0),
            "missing_keywords": len(gap_analysis.get('keywords_analysis', {}).get('missing_keywords', []) if gap_analysis else 0)
        }
    )
    # endregion

    user_prompt = f"""
Generate improved Data Analytics resume using gap analysis and curriculum.

## Original Resume Data
**Resume Text:**
{resume_text_content}

**Embedded Links:**
{json.dumps(resume_links, indent=2)}

## Gap Analysis (from Step 2)
{json.dumps(gap_analysis, indent=2)}

## Coding Ninjas Curriculum
{json.dumps(curriculum_text, indent=2)}

## Current Year
{CURRENT_YEAR}

## Instructions
1. Use gap_analysis to understand what user has vs needs
2. Identify which curriculum modules address the gaps
3. Enhance existing skills where curriculum offers advanced topics
4. Break down missing keywords into specific curriculum topics
5. Replace irrelevant projects with curriculum case studies (max 3-4 total projects)
6. Generate improved resume following ATS template
7. Classify skills correctly (enhanced vs added) based on original has_skills
8. **CRITICAL:** Use "Education" section name (NOT "Academic Details")
9. **CRITICAL:** For user_level "Fresher", completely SKIP Professional Experience section

## Key Validation Rules
- Base skill must exist in gap_analysis.skills_analysis.has_skills to be "enhanced"
- If original has_skills is empty/minimal, most skills go to "skills_added"
- In resume text TECHNICAL SKILLS section: show only final form, NO arrows
- In JSON tracking fields: use arrows to show enhancement path
- Education section MUST be named "Education"
- Professional Experience section: Include ONLY if user_level is NOT "Fresher" AND has relevant DA work experience

## Expected Focus Areas Based on Gap Analysis
- User Level: {gap_analysis.get('user_level', 'Unknown')}
- Missing Skills to Add: {gap_analysis.get('skills_analysis', {}).get('missing_skills', [])}
- Missing Keywords: {gap_analysis.get('keywords_analysis', {}).get('missing_keywords', [])}
- Projects to Remove: {gap_analysis.get('projects_analysis', {}).get('projects_to_remove', [])}
- Projects to Keep: {gap_analysis.get('projects_analysis', {}).get('projects_to_keep', [])}
"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt}
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=3500
    )
    
    result = json.loads(response.choices[0].message.content)

    # region agent log
    agent_debug_log(
        hypothesis_id="H4",
        location="backend/app.py:LLM2:post-call",
        message="LLM2 post-call received",
        data={
            "has_curriculum_mapping": "curriculum_mapping" in result,
            "modules_used": len(result.get("curriculum_mapping", {}).get("modules_used", [])),
            "has_improved_resume": "improved_resume" in result
        }
    )
    # endregion
    
    # Add metadata
    result['_metadata'] = {
        'model': 'gpt-4.1-mini',
        'timestamp': datetime.now().isoformat()
    }
    
    return result


def create_learning_comparison(curriculum_mapping, analysis):
    """
    Create comparison data for Conventional vs CN Course learning.
    Intelligently matches gaps to the curriculum modules that actually address them.
    """
    # Extract missing skills from analysis
    missing_skills = analysis.get('skills_analysis', {}).get('missing_skills', [])
    
    # Build a mapping of which modules address which gaps
    gap_to_module_map = {}
    
    for module in curriculum_mapping.get('modules_used', []):
        module_name = module.get('module', '')
        addresses_gaps = module.get('addresses_gaps', [])
        
        # For each gap this module addresses, map gap → module
        for gap in addresses_gaps:
            # Normalize gap name for matching (case-insensitive, strip whitespace)
            gap_normalized = gap.strip().lower()
            
            # Store the module info for this gap
            if gap_normalized not in gap_to_module_map:
                gap_to_module_map[gap_normalized] = {
                    "gap": gap,  # Original case
                    "module": module_name,
                    "timeline": module.get('timeline', 'Week 1-4'),
                    "description": module.get('how_used', 'Skill development')
                }
    
    # Now match missing skills to their corresponding modules
    modules_addressing_gaps = []
    matched_gaps = set()
    
    for gap in missing_skills[:10]:  # Check top 10 missing skills
        gap_normalized = gap.strip().lower()
        
        # Check if we have a module that addresses this gap
        if gap_normalized in gap_to_module_map and gap_normalized not in matched_gaps:
            modules_addressing_gaps.append(gap_to_module_map[gap_normalized])
            matched_gaps.add(gap_normalized)
            
            # Stop after finding 3 matches
            if len(modules_addressing_gaps) >= 3:
                break
    
    # If we didn't find 3 matches, fill with first available modules
    if len(modules_addressing_gaps) < 3:
        for module in curriculum_mapping.get('modules_used', []):
            if len(modules_addressing_gaps) >= 3:
                break
            
            module_name = module.get('module', '')
            # Check if this module is already in our list
            if not any(m['module'] == module_name for m in modules_addressing_gaps):
                # Use the first gap this module addresses
                first_gap = module.get('addresses_gaps', ['General Skills'])[0]
                modules_addressing_gaps.append({
                    "gap": first_gap,
                    "module": module_name,
                    "timeline": module.get('timeline', 'Week 1-4'),
                    "description": module.get('how_used', 'Skill development')
                })
    
    return {
        "conventional_learning": {
            "timeline": [
                {"month": 0, "progress": 0, "milestone": "Start Learning"},
                {"month": 2, "progress": 15, "milestone": "Basic SQL from YouTube"},
                {"month": 4, "progress": 30, "milestone": "Python basics from blogs"},
                {"month": 6, "progress": 50, "milestone": "Self-made projects"},
                {"month": 8, "progress": 65, "milestone": "Still learning Power BI"},
                {"month": 10, "progress": 80, "milestone": "Job applications start"},
                {"month": 12, "progress": 85, "milestone": "Interview ready"}
            ]
        },
        "cn_course_learning": {
            "timeline": [
                {"month": 0, "progress": 0, "milestone": "Enroll in CN Data Analytics Course"},
                {"month": 1, "progress": 35, "milestone": "SQL Mastery + Python Fundamentals"},
                {"month": 2, "progress": 60, "milestone": "Power BI & Data Visualization"},
                {"month": 3, "progress": 80, "milestone": "Statistical Analysis + Projects"},
                {"month": 4, "progress": 95, "milestone": "Capstone Project + Interview Prep"},
                {"month": 5, "progress": 100, "milestone": "Job Ready + Placement Support"}
            ],
            "modules_addressing_gaps": modules_addressing_gaps
        }
    }


def normalize_skill_name(skill):
    """
    Normalize skill names for matching (e.g., "MS Excel" -> "Excel", "Microsoft Excel" -> "Excel")
    """
    if not skill:
        return ""
    
    skill_lower = skill.lower().strip()
    
    # Common skill normalizations
    normalizations = {
        "ms excel": "excel",
        "microsoft excel": "excel",
        "mysql": "sql",
        "mssql": "sql",
        "sql server": "sql",
        "postgresql": "sql",
        "postgres": "sql",
    }
    
    # Check if skill matches any normalization pattern
    for pattern, normalized in normalizations.items():
        if pattern in skill_lower:
            return normalized
    
    # Return base skill name (lowercase, stripped)
    return skill_lower


def generate_market_stats(original_analysis):
    """Generate market statistics from LLM response (original_analysis)"""
    if not original_analysis:
        # Fallback
        return {
            "jobs_analyzed": 0,
            "top_skills": [],
            "avg_salary": "₹6-12 LPA",
            "conventional_time": "8-12 months",
            "cn_time": "4-6 months",
            "resume_has": 0,
            "curriculum_covers": 0
        }
    
    # Get level_specific_market_analysis from LLM response (all data comes from LLM)
    level_analysis = original_analysis.get('job_market_analysis', {})
    
    # Get jobs_analyzed from LLM (LLM counts the jobs it analyzed)
    jobs_analyzed = level_analysis.get('jobs_analyzed', 0)
    
    # Get top_skills from LLM response (changed from most_demanded_skills)
    top_skills_raw = level_analysis.get('top_skills', [])
    
    # Parse top_skills - format: "Excel (appears in 91.01% of jobs) - Demand: Critical"
    # All calculations (percentage, demand level) are done by LLM, we just extract
    top_skills_with_percentages = []
    for skill_str in top_skills_raw[:5]:  # Top 5 skills
        # Extract skill name (before the first parenthesis)
        skill_name = skill_str.split('(')[0].strip()
        
        # Extract percentage (decimal number before %) - LLM calculated this
        # Match pattern like "91.01%" or "81%" - handles both decimal and integer percentages
        percentage_match = re.search(r'(\d+\.?\d*)%', skill_str)
        if percentage_match:
            percentage = float(percentage_match.group(1))
        else:
            percentage = 0.0
        
        # Extract demand level - LLM determined this based on its analysis
        demand_match = re.search(r'Demand:\s*(\w+)', skill_str)
        demand = demand_match.group(1) if demand_match else "Growing"
        
        top_skills_with_percentages.append({
            "skill": skill_name,
            "percentage": round(percentage, 2),  # Round to 2 decimal places
            "demand": demand
        })
    
    # Count how many top skills the resume has (with normalization)
    top_skill_names = [s['skill'] for s in top_skills_with_percentages]
    resume_has_skills = original_analysis.get('skills_analysis', {}).get('has_skills', [])
    
    # Normalize all top skills and has_skills for matching
    normalized_top_skills = [normalize_skill_name(skill) for skill in top_skill_names]
    normalized_has_skills = [normalize_skill_name(skill) for skill in resume_has_skills]
    
    # Count matches (check if any normalized top_skill matches any normalized has_skill)
    resume_has_count = 0
    matched_top_skills = set()
    for normalized_top in normalized_top_skills:
        if normalized_top in normalized_has_skills and normalized_top not in matched_top_skills:
            resume_has_count += 1
            matched_top_skills.add(normalized_top)
    
    return {
        "jobs_analyzed": jobs_analyzed,  # From LLM
        "top_skills": top_skills_with_percentages,  # Parsed from LLM response (LLM did all calculations)
        "resume_has": resume_has_count,  # Count of top skills present in resume (with normalization)
        "curriculum_covers": len(top_skill_names)  # Total number of top skills
    }


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.route('/', methods=['GET'])
def root():
    """Root endpoint"""
    return jsonify({
        "status": "ok",
        "message": "AI Resume Analyzer API",
        "version": "2.0",
        "endpoints": {
            "health": "/api/health",
            "extract_text": "/api/extract-text",
            "analyze_resume": "/api/analyze-resume",
            "generate_improved_resume": "/api/generate-improved-resume"
        }
    })


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "message": "Backend is running",
        "market_insights_mode": "dynamic_from_llm"  # Market insights now generated from LLM responses
    })


@app.route('/api/extract-text', methods=['POST'])
def extract_text():
    """Extract text from uploaded resume file"""
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        filename = file.filename.lower()
        file_stream = io.BytesIO(file.read())
        
        if filename.endswith('.pdf'):
            pdf_content = extract_text_from_pdf(file_stream)
            text = pdf_content.get("text", "")
            links = pdf_content.get("links", [])
        elif filename.endswith('.docx'):
            text = extract_text_from_docx(file_stream)
            links = []
        elif filename.endswith('.txt'):
            text = extract_text_from_txt(file_stream)
            links = []
        else:
            return jsonify({"error": "Unsupported file format"}), 400
        
        if not text or len(text.strip()) < 50:
            return jsonify({"error": "Could not extract sufficient text"}), 400
        
        # Store extract-text data in memory for use in step 3 (only text and links)
        EXTRACT_TEXT_DATA['text'] = text
        EXTRACT_TEXT_DATA['links'] = links
        print(f"✓ Stored extract-text data in memory (text: {len(text)} chars, links: {len(links)})")
        
        # Prepare response data (only text and links)
        response_data = {
            "text": text,
            "links": links
        }
        
        return jsonify(response_data)
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/analyze-resume', methods=['POST'])
def analyze_resume():
    """Step 2: Analyze resume and determine Data Analytics level (AI Call #1)"""
    try:
        data = request.json
        resume_text = data.get('text', '')
        
        if not resume_text:
            return jsonify({"error": "No resume text provided"}), 400
        
        if not ANALYSIS_BY_LEVEL:
            return jsonify({"error": "Analysis data not available. Server may need restart."}), 500
        
        print("Step 2: Analyzing resume and determining Data Analytics level (LLM Call #1)...")
        print(f"Analysis data loaded - Fresher: ✓, Intermediate: ✓, Experienced: ✓")
        
        # Analyze original resume + determine Data Analytics level (AI Call #1)
        original_analysis = analyze_original_resume(resume_text, ANALYSIS_BY_LEVEL)
        
        # Log results
        user_level = original_analysis.get('user_level', 'Unknown')
        print(f"✓ User level detected: {user_level}")
        
        # Return minimal response - only what's needed for Step 3
        # All analysis data is in full_analysis (no top-level duplicates)
        # Note: resume_text is NOT included - frontend already has it from Step 1
        response_data = {
            "full_analysis": original_analysis  # Complete analysis - contains all fields
        }
        
        print("Step 2 complete! (LLM Call #1 done)")
        return jsonify(response_data)
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in analyze_resume: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500


@app.route('/api/generate-improved-resume', methods=['POST'])
def generate_improved_resume_endpoint():
    """Step 3: Generate improved resume with curriculum mapping (AI Call #2)"""
    try:
        data = request.json
        
        # Use extract-text data stored in memory from step 1
        resume_data = {}
        if EXTRACT_TEXT_DATA.get('text'):
            resume_data = {
                'text': EXTRACT_TEXT_DATA.get('text', ''),
                'links': EXTRACT_TEXT_DATA.get('links', [])
            }
            print(f"✓ Using extract-text data from memory (text: {len(resume_data['text'])} chars, links: {len(resume_data['links'])})")
        else:
            # Fallback: try to get from request
            print(f"Warning: No extract-text data in memory, trying to use data from request")
            resume_data = data.get('resume_data', {})
            
            # Backward compatibility: support old format where resume_text was sent as string
            if not resume_data or not resume_data.get('text'):
                resume_text_string = data.get('resume_text', '')
                if resume_text_string:
                    # Convert old format to new format
                    resume_data = {
                        'text': resume_text_string,
                        'links': data.get('links', [])
                    }
        
        # Extract text and links from the resume_data object
        resume_text = resume_data.get('text', '')  # Extract text string for response
        resume_links = resume_data.get('links', [])  # Extract links array
        
        original_analysis = data.get('full_analysis', {})
        
        # Also support step2_response format if frontend sends complete object (backward compatibility)
        if not original_analysis:
            step2_response = data.get('step2_response', {})
            if step2_response:
                original_analysis = step2_response.get('full_analysis', {})
        
        if not resume_text:
            return jsonify({"error": "Resume data is required. Must include 'resume_data' with 'text' field (from Step 1 extract-text)."}), 400
        
        if not original_analysis:
            return jsonify({"error": "Step 2 analysis is required. Must include 'full_analysis'."}), 400
        
        print("Step 3: Generating improved resume with curriculum mapping (LLM Call #2)...")
        print(f"✓ Received resume_data from frontend with text ({len(resume_text)} chars) and {len(resume_links)} links")
        
        
        # Generate improved resume + curriculum mapping (AI Call #2)
        # Pass resume_data (full object with text and links) to LLM
        improved_result = generate_improved_resume(
            resume_data,  # Pass full JSON object containing both text and links
            original_analysis,
            curriculum_text
        )
        
        # Extract curriculum mapping and improved resume from result
        curriculum_mapping = improved_result['curriculum_mapping']
        improved_resume = improved_result['improved_resume']
        modification_summary = improved_result.get('modification_summary', '')
        section_improvements = improved_result.get('section_improvements', [])
        
        # Create learning comparison (no AI, uses data from Step 3)
        print("Creating learning comparison...")
        learning_comparison = create_learning_comparison(
            curriculum_mapping,
            original_analysis
        )
        
        # Generate market stats from LLM response (original_analysis)
        print("Generating market stats from LLM response...")
        market_stats = generate_market_stats(original_analysis)
        
        # Compile final response
        response_data = {
            "original": {
                "resume_text": resume_text,
                "job_relevance_score": original_analysis.get('scores', {}).get('job_relevance_score', 0),
                "ats_score": original_analysis.get('scores', {}).get('ats_score', 0),
                "has_skills": original_analysis.get('skills_analysis', {}).get('has_skills', []),
                "missing_skills": original_analysis.get('skills_analysis', {}).get('missing_skills', []),
                "user_level": original_analysis.get('user_level', ''),
                "level_reasoning": original_analysis.get('level_reasoning', ''),
                "analysis_summary": original_analysis.get('analysis_summary', '')
            },
            "improved": {
                "resume_text": improved_resume['improved_text'],
                "job_relevance_score": improved_resume['job_relevance_score'],
                "ats_score": improved_resume['ats_score'],
                "skills_added": improved_resume['skills_added'],
                "skills_enhanced": improved_resume['skills_enhanced'],
                "projects_added": improved_resume['projects_added'],
                "modification_summary": modification_summary,
            },
            "learning_comparison": learning_comparison,
            "market_stats": market_stats,
            "curriculum_used": curriculum_mapping['modules_used']
        }
        
        print("Step 3 complete! (LLM Call #2 done, analysis complete)")
        return jsonify(response_data)
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in generate_improved_resume_endpoint: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500


if __name__ == '__main__':
    port = int(config.get('PORT') or os.getenv('PORT', 5000))
    app.run(debug=True, port=port, host='0.0.0.0')