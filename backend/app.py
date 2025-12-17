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
from pathlib import Path

# Load environment variables from .env file (if exists) or from environment
config = dotenv_values('.env')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize OpenAI client - use environment variable if .env file doesn't have it
openai_api_key = config.get('OPENAI_API_KEY') or os.getenv('OPENAI_API_KEY')
client = OpenAI(api_key=openai_api_key)

# API Response logging configuration
RESPONSE_LOG_DIR = Path(__file__).parent.parent / 'response'

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


def save_api_response(endpoint_name: str, response_data: dict):
    """
    Save API response to JSON file in the response folder.
    Overwrites the file to keep only the latest response.
    
    Args:
        endpoint_name: Name of the endpoint (e.g., 'extract-text', 'analyze-resume', 'generate-improved-resume')
        response_data: The response data dictionary to save
    """
    try:
        # Ensure response directory exists
        RESPONSE_LOG_DIR.mkdir(parents=True, exist_ok=True)
        
        # Construct file path
        log_file = RESPONSE_LOG_DIR / f"{endpoint_name}.json"
        
        # Write response data (overwrites existing file)
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(response_data, f, indent=2, ensure_ascii=False)
        
        print(f"✓ Saved API response to {log_file}")
    except Exception as e:
        # Logging failures should never break main flow
        print(f"Warning: Failed to save API response for {endpoint_name}: {e}")

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

    # ----------------------------
    # CALL 2: Assessment & Scoring
    # ----------------------------
    system_message_assess = """
# Role
You are a Data Analytics resume evaluator and ATS expert.

# Task
Evaluate resume quality and calculate scores using the gap analysis context.

# Instructions

## Step 1: Keyword Analysis
Extract ALL specific technical keywords, tools, techniques, and methodologies mentioned in the resume:
- Include specific functions/features (e.g., "CTEs", "Window Functions", "Power Query", "DAX")
- Include libraries and packages (e.g., "Pandas", "NumPy", "Matplotlib")
- Include specific techniques (e.g., "RFM Analysis", "Pivots", "VLOOKUP")
- DO NOT just list base tools (SQL, Python, Excel) - extract the SPECIFIC capabilities mentioned

Then compare against market top skills to identify what's missing.

**Output:**
- present_keywords: List of ALL specific technical keywords found (not just tool names)
- missing_keywords: Market keywords NOT found in present_keywords

## Step 2: ATS Compatibility
Assess structure/format for ATS friendliness (1-2 sentences).

## Step 3: Calculate Scores
Apply scoring guidelines for job relevance and ATS scores.

# Output (JSON only)
{
  "keywords_analysis": {
    "present_keywords": ["CTEs", "Window Functions", "Pandas", "NumPy", ...],
    "missing_keywords": ["Power Query", "Data Modeling", ...]
  },
  "ats_analysis": {"reasoning": "1-2 sentence max"},
  "scores": {"job_relevance_score": 0, "ats_score": 0, "score_reasoning": "1-2 sentence max"},
  "job_market_analysis": {
    "jobs_analyzed": <integer>,
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
# STEP 3: Generate Improved Resume + Curriculum Mapping (Prompt Chaining)
# ============================================================================
CURRENT_YEAR = datetime.now().year + 1

def load_curriculum_json():
    """Load raw curriculum JSON data for prompts"""
    curriculum_file = Path(__file__).parent.parent / 'data-analytics-curriculum.json'
    try:
        with open(curriculum_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading curriculum JSON: {e}")
        return None

def prompt_1_strategy_generation(gap_analysis, curriculum_data):
    """
    PROMPT 1: Strategy Generation (REWORKED)
    Variance Reduction: 30% → 8%
    """
    system_message = """
# Role
You are a resume strategy analyst specializing in Data Analytics roles and Coding Ninjas Data Analytics curriculum.

# Task
Generate skill & project improvement strategy based on gap analysis and curriculum.

# Instructions

## 1. Skill Analysis
Using the gap_analysis and curriculum provided:

### 1a. Identify Skills to Enhance

Examine each skill in has_skills and determine if it can be enhanced with advanced topics from the curriculum:
1. Identify what advanced topics would enhance this skill while making sure they are relavant to the user experience
2. Check if those advanced topics are already in present_keywords
3. If advanced topics are MISSING from present_keywords → add to skills_to_enhance
4. If advanced topics are ALREADY in present_keywords → skip (already covered)
5. Never add basic concepts to skills_to_enhance if user_level is Intermediate or Experienced.

**Example:**

Given:
- user_level: "Intermediate"
- has_skills: ["Excel", "SQL", "Python"]
- present_keywords: ["Power Query", "Pandas", "Numpy", "Matplotlib"]

Internal Reasoning:
- Excel → Advanced: "Power Query" → Found in present_keywords → Skip
- SQL → Advanced: "CTEs, Window Functions" → NOT found in present_keywords → Include
- Python → Advanced: "NumPy, Pandas, Matplotlib" → Found in present_keywords → Skip
- Python → Advanced: "Object Oriented Programming (OOP)" → user_level is Intermediate → Skip

Output:
skills_to_enhance = [{"base": "SQL","enhanced": "Advanced SQL (CTEs, Window Functions)","module": "Analytics with SQL"}]

### 1b. Identify Skills to Add
Use missing_skills (already filtered to curriculum)
- If missing_skills is empty, then skip this step and move to project strategy.
 - Output: skills_to_add = []
- If not then, map each missing skill to its curriculum module using the curriculum_data
 - Output: skills_to_add = [{"skill": "Power BI", "module": "Data Visualization with PowerBi"}]

## 2. Project Strategy
Using projects_analysis:

### 2a. Remove Irrelevant Projects
- Remove all projects listed in projects_to_remove
- These are non-DA projects that add no value

### 2b. Add Curriculum Case Studies as Projects
- Add case studies from curriculum modules that (equivalent to the length of projects_to_remove field):
  - Support skills being added/enhanced
  - Are most relevant to user_level (Fresher/Intermediate/Experienced)
- For each case study, create a project entry:
  - Project Name: Use case study name from curriculum_data
  - Technologies: List relevant skills from that module
  - Description: 2-3 sentences about what analysis was done
- Output: projects_to_add = [{"name": "US Healthcare Dataset Analysis", "module": "Introduction to Data Analytics and Excel", "technologies": ["Excel", "Power Query"], "description": "..."}]

### 2c. Keep Relevant Projects
- Retain all projects from projects_to_keep with original description
- These are existing DA-relevant projects

### Final Project List
- If projects_to_add & projects_to_keep have same projects then remove the duplicate project from projects_to_add.
- Total projects = New projects + the projects_to_keep (after removing duplicates).
- Order: Most relevant to DA first
- Balance: User's existing projects + curriculum case studies

### Output Format
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
  }

### Module Tracking
For each module used:
- module: Exact name from curriculum
- addresses_gaps: List specific skills/keywords it addresses
- projects_included: List case studies used as projects
- skills_added_from_module: New skills from this module
- skills_enhanced_by_module: Enhanced skills using this module

### Output Format
"curriculum_mapping": {
    "modules_used": [
      {
        "module": "Exact module name",
        "addresses_gaps": ["skill1", "skill2"],
        "projects_included": ["case study name"],
        "keywords_addressed": ["keyword1", "keyword2"],
        "skills_added_from_module": ["skill1"],
        "skills_enhanced_by_module": ["base → enhanced"]
      }
    ]
  }

# Output Schema (JSON only)
{
  "skill_strategy": {
    "skills_to_enhance": [
      {"base": "Excel", "enhanced": "Advanced Excel (Power Query)", "module": "..."}
    ],
    "skills_to_add": [
      {"skill": "Power BI", "module": "..."}
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
  }

# Critical Rules
- Verify each skill appears in ONLY ONE place (enhance OR add)
- Python libraries are enhancements if Python exists, otherwise Python is added
- Select projects matching user_level complexity exactly
- Track ALL modules used in curriculum_mapping
"""
    has_skills = gap_analysis.get('skills_analysis', {}).get('has_skills', [])
    missing_skills = gap_analysis.get('skills_analysis', {}).get('missing_skills', [])
    present_keywords = gap_analysis.get('keywords_analysis', {}).get('present_keywords', [])
    user_level = gap_analysis.get('user_level', 'Unknown')
    projects_to_remove = gap_analysis.get('projects_analysis', {}).get('projects_to_remove', [])
    projects_to_keep = gap_analysis.get('projects_analysis', {}).get('projects_to_keep', [])
    
    user_prompt = f"""Generate improvement strategy for Data Analytics resume.

## Critical Gap Analysis
- **has_skills:** 
{json.dumps(has_skills)}

- **Missing skills:** 
{json.dumps(missing_skills)}

- **present_keywords:** 
{json.dumps(present_keywords)}

- **User level:** 
{user_level}

## Project Info
- **Projects to remove (count={len(projects_to_remove)}):** 
{json.dumps(projects_to_remove)}

- **Projects to keep:** 
{json.dumps(projects_to_keep)}

## Coding Ninjas Curriculum
{json.dumps(curriculum_data, indent=2)}
"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt}
        ],
        response_format={"type": "json_object"},
        temperature=0.0,  # Fully deterministic
        max_tokens=1024
    )
    
    strategy = json.loads(response.choices[0].message.content)
    
    # Validation checks
    if 'modules_used' not in strategy:
        print("⚠️ Warning: modules_used missing from strategy")
        strategy['modules_used'] = []
    
    print("✓ Prompt 1: Strategy generation complete")
    print(f"  - Skills to enhance: {len(strategy.get('skill_strategy', {}).get('skills_to_enhance', []))}")
    print(f"  - Skills to add: {len(strategy.get('skill_strategy', {}).get('skills_to_add', []))}")
    print(f"  - Projects to add: {len(strategy.get('project_strategy', {}).get('projects_added', []))}")
    print(f"  - Modules tracked: {len(strategy.get('curriculum_mapping', {}).get('modules_used', []))}")
    print(json.dumps(strategy, indent=2))
    
    return strategy


def prompt_2_resume_writing(resume_data, strategy, gap_analysis):
    """
    PROMPT 2: Resume Writing (REWORKED)
    Variance Reduction: 30% → 10%
    """
    system_message = """
# Role
You are an ATS resume writer specializing in Data Analytics roles.

# Task
Generate an improved ATS-friendly resume utilizing only the provided improvement strategy, original user resume and Curriculum Mapping.

# Template Structure
Follow this ATS-friendly structure:

## HEADER SECTION
[FULL NAME - from original, all caps]
Email | Phone | Location | LinkedIn | GitHub 
[Only use the contact info present in the original resume and embedded links, remove the contact info that is not present in the original resume]

## PROFESSIONAL SUMMARY
2 sentences maximum: [Professional Title based on user_level] with expertise in [top 2-4 skills including enhanced ones], experienced in [domain/projects], seeking to leverage [skills] for [DA role type].

## TECHNICAL SKILLS
• **Programming & Languages:** [list skills with enhancements grouped]
• **Data Visualization:** [Power BI, Tableau, Excel, etc.]
• **Other Tools:** [Jupyter, etc.]

{CONDITIONAL_SECTION - see decision tree below}

## EDUCATION
[Only include graduation or post graduation details from the resume, ignore the school details]

## PROJECTS
[Only Add projects_to_keep from the original resume]
[Only Add projects_to_add from the improvement strategy]

## CERTIFICATIONS
[All original certifications with certificate link placeholder text (if present)]
[IF no Data Analytics certification exists: Add "Data Analytics | Coding Ninjas | {CURRENT_YEAR}"]

---

## Professional Experience Decision Tree

**STEP 1: Check User Level**
IF user_level = "Fresher" → SKIP this entire section, go directly to Education

**STEP 2: Check if Original Has Work Experience**
Look for sections: "Experience", "Work Experience", "Professional Experience", "Employment"
IF not found → SKIP section, go to Education

**STEP 3: Check if DA-Related**
DA-Related roles:
- Data Analyst, Business Analyst, BI Analyst, Analytics Engineer
- Data Scientist, SQL Developer, Database Analyst
- Technical roles with quantitative analysis (e.g., Software Engineer with A/B testing, metrics)

NOT DA-Related:
- Pure non-technical (Sales without analytics, Marketing without data, HR)
- Service roles (Customer service, retail, hospitality)
- Admin roles without analytics

**STEP 4: Final Decision**
IF (user_level != "Fresher") AND (original has work experience) AND (role is DA-related):
  - INCLUDE Professional Experience section (keep original content, add keywords naturally)
ELSE:
  - SKIP section entirely

---

## TECHNICAL SKILLS FORMAT (MANDATORY)

Use EXACTLY these four categories (no more, no less):

**Programming & Languages:** Python (sub-skills), SQL (sub-skills), R (if applicable)

**Database Management:** MySQL, PostgreSQL, SQL Server, etc.

**Data Visualization & BI:** Power BI (sub-skills), Tableau, Excel (sub-skills)
  - Include: All visualization and BI tools
  - Group with parentheses for enhancements

**Soft Skills:** Communication, Teamwork, Problem Solving, Time Management, etc.
  - Include: rely on the original resume for soft skills and if not present then add them based on the user_level.

**Other Tools:** Jupyter Notebook, Git, VS Code, etc.
  - Include: Development tools, IDEs, version control
  - List comma-separated

**CRITICAL:**
- Use these EXACT category names with bold formatting: **Category Name:**
- Do NOT use category names from the original resume
- Do NOT combine categories (e.g., "Database Management & Querying" → split to "Programming & Languages" for SQL, "Database Management" for MySQL)
- Do NOT create new categories beyond these four

---

## Project Description Templates

**Structure per project:**
For original projects:
- retain all the original details: project name, description, project links placeholder text, dates
For curriculum case studies:
Format: [Project Name]
- Bullet points description (3 points) highlighting analysis, Technologies & Techniques used, outcomes, etc.

**CRITICAL:**
- NO invented metrics ("processed 50,000 records" if not in original)
- NO invented outcomes ("increased revenue 15%" if not stated)
- Use case study details if from curriculum
- Use original details if from user's resume
- For improving the skills and projects rely only on the improvement strategy provided.

---

## FINAL VERIFICATION CHECKLIST

Before outputting resume, verify:

## Professional Experience:
  - Fresher → section DOES NOT exist
  - Non-Fresher → included only if original had DA-related role

## Education:
  - Section name is "Education" (NOT "Academic Details")
  - Exactly copy the graduation or post graduation details from the resume, ignore the school details.

## Technical Skills:
  - NO arrows (→) anywhere
  - Skills grouped: "Python (NumPy, Pandas)" not separate
  - Categories bolded: **Programming:**
  - skills and projects should be based on the improvement strategy provided.

## Projects:
  - NO invented metrics/outcomes
  - 3 bullets per project using templates
  - Removed projects NOT included

## Contact Info:
  - All original info preserved
  - All links preserved exactly

## No extra text or sections or commentary is present in the resume, if found remove it.

# Output
Generate complete resume text only (no JSON, no reasoning).
Use plain text format, NOT markdown code blocks."""

    resume_text_content = resume_data.get('text', '')
    resume_links = resume_data.get('links', [])
    user_level = gap_analysis.get('user_level', 'Unknown')
    
    # Extract strategy components for clarity
    skills_enhance = strategy.get('skill_strategy', {}).get('skills_to_enhance', [])
    skills_add = strategy.get('skill_strategy', {}).get('skills_to_add', [])
    projects_remove = strategy.get('project_strategy', {}).get('projects_removed', [])
    projects_keep = strategy.get('project_strategy', {}).get('projects_kept', [])
    projects_add = strategy.get('project_strategy', {}).get('projects_added', [])
    
    user_prompt = f"""Write improved Data Analytics resume.

## Original Resume
{resume_text_content}

## Embedded Links (preserve exactly)
{json.dumps(resume_links, indent=2)}

## Improvement Strategy

**Skills to Enhance:**
{json.dumps(skills_enhance, indent=2)}

**Skills to Add:**
{json.dumps(skills_add, indent=2)}

**Projects to Remove:**
{json.dumps(projects_remove)}

**Projects to Keep:**
{json.dumps(projects_keep)}

**Projects to Add:**
{json.dumps(projects_add, indent=2)}

**Curriculum Mapping:**
{json.dumps(strategy.get('curriculum_mapping', {}), indent=2)}

## User Context
- User Level: {user_level}
- Current Year: {CURRENT_YEAR}
"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.0,  # Lower for more consistency
        max_tokens=2000
    )
    
    improved_text = response.choices[0].message.content.strip()
    
    # Remove markdown code blocks if present
    if improved_text.startswith('```'):
        lines = improved_text.split('\n')
        improved_text = '\n'.join(lines[1:-1])  # Remove first and last lines
    
    print("✓ Prompt 2: Resume writing complete")
    print(f"  - Output length: {len(improved_text)} characters")
    print(improved_text)
    
    return improved_text


def extract_sections_for_comparison(resume_text):
    """Extract specific sections needed for classification"""
    import re
    
    sections = {}
    
    # Extract Technical Skills
    skills_patterns = [
        r'TECHNICAL SKILLS[\s\S]*?(?=\n[A-Z][A-Z\s]{10,}|\n\n[A-Z]|$)',
        r'Technical Skills[\s\S]*?(?=\n[A-Z][A-Z\s]{10,}|\n\n[A-Z]|$)',
        r'SKILLS[\s\S]*?(?=\n[A-Z][A-Z\s]{10,}|\n\n[A-Z]|$)'
    ]
    for pattern in skills_patterns:
        match = re.search(pattern, resume_text, re.IGNORECASE)
        if match:
            sections['technical_skills'] = match.group(0).strip()
            break
    
    if 'technical_skills' not in sections:
        sections['technical_skills'] = resume_text[:800]  # Fallback
    
    # Extract Projects
    projects_patterns = [
        r'PROJECTS[\s\S]*?(?=\nCERTIFICATIONS|\nEDUCATION|\n[A-Z][A-Z\s]{10,}:|$)',
        r'Projects[\s\S]*?(?=\nCertifications|\nEducation|\n[A-Z][A-Z\s]{10,}:|$)'
    ]
    for pattern in projects_patterns:
        match = re.search(pattern, resume_text, re.IGNORECASE)
        if match:
            sections['projects'] = match.group(0).strip()
            break
    
    if 'projects' not in sections:
        sections['projects'] = ""
    
    return sections

def prompt_3_tracking_scoring(improved_resume_text, strategy, gap_analysis, scoring_guidelines):
    """
    PROMPT 3: Tracking & Scoring (SIMPLIFIED)
    Extract classifications from strategy, score the improved resume
    """
    system_message = f"""
# Role
You are a resume analyzer and ATS scoring expert.

# Task
1. Extract planned changes from strategy (source of truth)
2. Score the improved resume using provided guidelines

# CRITICAL: Strategy is Source of Truth

The strategy object contains the planned changes:
- skill_strategy.skills_to_enhance: List of skills that were enhanced
- skill_strategy.skills_to_add: List of skills that were added
- project_strategy.projects_added: List of projects that were added

# Classification Algorithm

## Step 1: Extract from Strategy
```python
skills_to_enhance = strategy.skill_strategy.skills_to_enhance
skills_to_add = strategy.skill_strategy.skills_to_add
projects_to_add = strategy.project_strategy.projects_added
```

## Step 2: Transform to Output Format

For skills_enhanced:
- Convert: {{"base": "SQL", "enhanced": "Advanced SQL (CTEs)"}} 
  → {{"original": "SQL", "improved": "Advanced SQL (CTEs)"}}

For skills_added:
- Extract: [{{"skill": "Statistics"}}] → ["Statistics"]

For projects_added:
- Extract: [{{"name": "Loan Default"}}] → ["Loan Default"]

## Step 3: Copy Curriculum Mapping

Copy curriculum_mapping.modules_used from strategy unchanged.

# SCORING RUBRICS

{scoring_guidelines}

## Estimated Improvement (%)
Calculate based on:
- Number of skills enhanced/added vs total gaps
- Number of projects improved
Formula: ((skills_enhanced + skills_added + projects_added) / max(total_gaps, 5)) * 100
Cap at 100%.

# Output Schema (JSON only)
{{
  "classification": {{
    "skills_enhanced": [{{"original": "SQL", "improved": "Advanced SQL (CTEs, Window Functions)"}}],
    "skills_added": ["Statistics"],
    "projects_added": ["Loan Default"]
  }},
  "curriculum_mapping": {{
    "modules_used": [/* copy from strategy */]
  }},
  "scores": {{
    "job_relevance_score": 88,
    "ats_score": 92,
    "estimated_improvement": 60
  }},
  "summary": "Enhanced X skills, added Y skills, incorporated Z projects, improving overall DA job readiness by N%."
}}

# Critical Rules
- Extract classifications from strategy - NEVER invent from resume
- Score ONLY the improved resume (not a comparison)
- Apply scoring rubrics strictly based on user level
- Counts must match strategy exactly
"""

    # Context for scoring
    missing_skills = gap_analysis.get('skills_analysis', {}).get('missing_skills', [])
    total_missing = len(missing_skills)
    user_level = gap_analysis.get('user_level', 'Unknown')
    
    # Get market analysis for scoring context
    job_market = gap_analysis.get('job_market_analysis', {})
    top_skills = job_market.get('top_skills', [])
    
    user_prompt = f"""Extract classifications and score improved resume.

## Strategy (SOURCE OF TRUTH for classifications)
{json.dumps(strategy, indent=2)}

## Improved Resume (for scoring only)
{improved_resume_text}

## Context for Scoring
- User level: {user_level}
- Market top skills: {json.dumps(top_skills[:10])}
- Jobs analyzed: {job_market.get('jobs_analyzed', 0)}
- Total gaps addressed: {total_missing}

Instructions:
1. Extract classifications from strategy (DO NOT analyze resume for classification)
2. Transform to output format
3. Score the improved resume using scoring guidelines
4. Calculate estimated improvement percentage
5. Generate summary with exact counts"""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt}
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
        max_tokens=1000
    )
    
    result = json.loads(response.choices[0].message.content)

    # Validation & Fallbacks
    strategy_enhance_count = len(strategy.get('skill_strategy', {}).get('skills_to_enhance', []))
    strategy_add_count = len(strategy.get('skill_strategy', {}).get('skills_to_add', []))
    strategy_projects_count = len(strategy.get('project_strategy', {}).get('projects_added', []))
    
    result_enhance_count = len(result.get('classification', {}).get('skills_enhanced', []))
    result_add_count = len(result.get('classification', {}).get('skills_added', []))
    result_projects_count = len(result.get('classification', {}).get('projects_added', []))
    
    # Rebuild from strategy if counts don't match
    if (result_enhance_count != strategy_enhance_count or 
        result_add_count != strategy_add_count or 
        result_projects_count != strategy_projects_count):
        
        print("⚠️ Classification mismatch - rebuilding from strategy...")
        
        skills_enhanced = [
            {"original": item.get('base', ''), "improved": item.get('enhanced', '')}
            for item in strategy.get('skill_strategy', {}).get('skills_to_enhance', [])
        ]
        
        skills_added = [
            item.get('skill', '') 
            for item in strategy.get('skill_strategy', {}).get('skills_to_add', [])
        ]
        
        projects_added = [
            item.get('name', '') 
            for item in strategy.get('project_strategy', {}).get('projects_added', [])
        ]
        
        result['classification'] = {
            "skills_enhanced": skills_enhanced,
            "skills_added": skills_added,
            "projects_added": projects_added
        }
    
    # Ensure curriculum_mapping exists
    if 'curriculum_mapping' not in result:
        result['curriculum_mapping'] = strategy.get('curriculum_mapping', {"modules_used": []})
    
    # Ensure scores exist
    if 'scores' not in result:
        print("⚠️ Warning: scores missing, using defaults")
        result['scores'] = {
            "job_relevance_score": 85,
            "ats_score": 88,
            "estimated_improvement": 50
        }
    
    print("✓ Prompt 3: Tracking & scoring complete")
    print(f"  - Skills enhanced: {result_enhance_count}")
    print(f"  - Skills added: {result_add_count}")
    print(f"  - Projects added: {result_projects_count}")
    print(f"  - Job relevance: {result.get('scores', {}).get('job_relevance_score', 0)}")
    print(f"  - ATS score: {result.get('scores', {}).get('ats_score', 0)}")
    
    return result

def generate_improved_resume(resume_data, gap_analysis, curriculum_text):
    """
    Generate improved resume using prompt chaining (3 sequential prompts).
    """
    if not gap_analysis:
        raise ValueError("Step 2 analysis is required")

    curriculum_data = load_curriculum_json()
    if not curriculum_data:
        raise ValueError("Curriculum data not available")
    
    print("Step 3: Starting prompt chaining (3 sequential prompts)...")
    
    # PROMPT 1: Strategy Generation
    print("  → Prompt 1: Generating strategy...")
    strategy = prompt_1_strategy_generation(gap_analysis, curriculum_data)
    
    # PROMPT 2: Resume Writing
    print("  → Prompt 2: Writing improved resume...")
    improved_resume_text = prompt_2_resume_writing(resume_data, strategy, gap_analysis)
    
    # PROMPT 3: Tracking & Scoring
    print("  → Prompt 3: Classifying changes and scoring...")
    tracking = prompt_3_tracking_scoring(
        improved_resume_text, 
        strategy, 
        gap_analysis,
        SCORING_GUIDELINES  # ✅ Pass scoring guidelines
    )
    
    # Extract components
    classification = tracking.get('classification', {})
    scores = tracking.get('scores', {})
    curriculum_mapping = strategy.get('curriculum_mapping', {'modules_used': []})
    modification_summary = tracking.get('summary', '')
    
    # Convert skills_enhanced from objects to arrow format
    skills_enhanced_list = []
    for item in classification.get('skills_enhanced', []):
        if isinstance(item, dict):
            skills_enhanced_list.append(f"{item.get('original', '')} → {item.get('improved', '')}")
        else:
            skills_enhanced_list.append(item)
    
    # ✅ Use correct paths from strategy
    result = {
        "skill_strategy": strategy.get('skill_strategy', {}),
        "project_strategy": strategy.get('project_strategy', {}),
        "curriculum_mapping": curriculum_mapping,
        "improved_resume": {
            "improved_text": improved_resume_text,
            "skills_added": classification.get('skills_added', []),
            "skills_enhanced": skills_enhanced_list,
            "projects_added": classification.get('projects_added', []),
            "job_relevance_score": scores.get('job_relevance_score', 0),
            "ats_score": scores.get('ats_score', 0),
            "estimated_improvement": scores.get('estimated_improvement', 0)
        },
        "modification_summary": modification_summary
    }
    
    # Add metadata
    result['_metadata'] = {
        'model': 'gpt-4.1-mini',
        'prompt_chain': True,
        'timestamp': datetime.now().isoformat()
    }
    
    print("✓ Step 3: Prompt chaining complete (3 prompts executed)")
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
        
        # Save response to JSON file
        save_api_response("extract-text", response_data)
        
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
        
        # Save response to JSON file
        save_api_response("analyze-resume", response_data)
        
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
        
        print("Step 3: Generating improved resume with curriculum mapping (Prompt Chaining: 3 sequential prompts)...")
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
            "skill_strategy": improved_result.get('skill_strategy', {}),
            "learning_comparison": learning_comparison,
            "market_stats": market_stats,
            "curriculum_used": curriculum_mapping['modules_used']
        }
        
        # Save response to JSON file
        save_api_response("generate-improved-resume", response_data)
        
        print("Step 3 complete! (Prompt chaining done: 3 prompts executed, analysis complete)")
        return jsonify(response_data)
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error in generate_improved_resume_endpoint: {error_details}")
        return jsonify({"error": str(e), "details": error_details}), 500


if __name__ == '__main__':
    port = int(config.get('PORT') or os.getenv('PORT', 5000))
    app.run(debug=True, port=port, host='0.0.0.0')