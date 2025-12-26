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
from concurrent.futures import ThreadPoolExecutor

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
    "Excel", "Power BI", "SQL", "Python", "NumPy", "Pandas",
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

# ============================================================================
# COMMON RETRY HELPER FOR LLM CALLS
# ============================================================================

def response_retry_helper(
    model,
    messages,
    response_format,
    temperature,
    initial_max_tokens,
    retry_max_tokens,
    method_name="unknown_method"
):
    """
    Common retry helper for LLM API calls with automatic token increase on failure.
    
    Args:
        model: OpenAI model name (e.g., "gpt-4.1-mini")
        messages: List of message dicts for the API call
        response_format: Response format dict (e.g., {"type": "json_object"})
        temperature: Temperature setting
        initial_max_tokens: Initial max_tokens value
        retry_max_tokens: Max_tokens value to use on retry
        method_name: Name of the calling method (for logging/tracking)
    
    Returns:
        tuple: (response_content, retry_attempted)
            - response_content: The parsed JSON content (if response_format is json_object) or raw content
            - retry_attempted: Boolean indicating if a retry was performed
    
    Raises:
        ValueError: If response is still truncated after retry
        json.JSONDecodeError: If JSON parsing fails after retry
    """
    retry_attempted = False
    content = None
    
    for attempt in range(2):  # Initial attempt + 1 retry
        try:
            current_max_tokens = retry_max_tokens if attempt > 0 else initial_max_tokens
            
            if attempt > 0:
                print(f"  → Retry attempt {attempt} for {method_name} with max_tokens={current_max_tokens}")
            
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                response_format=response_format,
                temperature=temperature,
                max_tokens=current_max_tokens
            )
            
            content = response.choices[0].message.content
            
            # Check if response was truncated
            if response.choices[0].finish_reason == "length":
                if attempt == 0:
                    retry_attempted = True
                    print(f"  ⚠ Response truncated in {method_name}, retrying with max_tokens={retry_max_tokens}...")
                    continue
                else:
                    raise ValueError(f"Response still truncated after retry in {method_name}. Consider increasing retry_max_tokens.")
            
            # Parse JSON if response_format is json_object
            if response_format.get("type") == "json_object":
                parsed_content = json.loads(content)
                if retry_attempted:
                    print(f"  ✓ {method_name} succeeded after retry")
                return parsed_content, retry_attempted
            else:
                if retry_attempted:
                    print(f"  ✓ {method_name} succeeded after retry")
                return content, retry_attempted
                
        except json.JSONDecodeError as e:
            if attempt == 0:
                retry_attempted = True
                print(f"  ⚠ JSON parse error in {method_name} (attempt {attempt + 1}), retrying with max_tokens={retry_max_tokens}...")
                print(f"    Error: {e}")
                print(f"    Response preview (first 500 chars): {content[:500] if content else 'None'}...")
                continue
            else:
                # Log the partial response for debugging
                print(f"  ✗ Failed to parse JSON in {method_name} after retry")
                print(f"    Error: {e}")
                print(f"    Response length: {len(content) if content else 0}")
                print(f"    Response preview (first 500 chars): {content[:500] if content else 'None'}...")
                print(f"    Response preview (last 500 chars): {content[-500:] if content else 'None'}...")
                raise
        except Exception as e:
            if attempt == 0 and (isinstance(e, ValueError) or "truncated" in str(e).lower()):
                retry_attempted = True
                print(f"  ⚠ Error in {method_name} (attempt {attempt + 1}), retrying with max_tokens={retry_max_tokens}...")
                print(f"    Error: {e}")
                continue
            else:
                print(f"  ✗ Error in {method_name}: {e}")
                raise
    
    # Should not reach here, but just in case
    raise ValueError(f"Unexpected error in {method_name} retry logic")

# Store extract-text response in memory for use in step 3
EXTRACT_TEXT_DATA = {}

# ============================================================================
# HELPER FUNCTIONS - Document Processing
# ============================================================================

import fitz  # PyMuPDF
import re

def extract_text_from_pdf(file_stream):
    """
    Extract text and All links (embedded + plain-text).
    Returns:
    {
        "text": str,
        "links": [
            {
                "url": str,
                "text": str
            }
        ]
    }
    """
    try:
        pdf_bytes = file_stream.read()
        file_stream.seek(0)

        pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")

        text_parts = []
        links = []

        for page_num in range(len(pdf_document)):
            page = pdf_document[page_num]

            # -------- Text Extraction (unchanged logic) --------
            text_dict = page.get_text("dict")
            blocks = []

            for block in text_dict.get("blocks", []):
                if "lines" not in block:
                    continue
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

            # -------- Embedded Hyperlink Extraction --------
            for link in page.get_links():
                uri = link.get("uri")
                if not uri:
                    continue

                lower_uri = uri.lower()
                if not (
                    lower_uri.startswith("http")
                    or lower_uri.startswith("mailto:")
                ):
                    continue

                anchor_text = ""
                if link.get("from"):
                    try:
                        anchor_text = page.get_text("text", clip=link["from"]).strip()
                    except Exception:
                        anchor_text = ""

                links.append({
                    "url": uri.strip(),
                    "text": anchor_text
                })

            # -------- Plain-text URL Extraction --------
            text_urls = re.findall(r'https?://\S+', page_text)
            for url in text_urls:
                links.append({
                    "url": url.strip().rstrip(").,]"),
                    "text": ""
                })

        pdf_document.close()

        # -------- Deduplicate Links --------
        unique_links = {}
        for link in links:
            key = link["url"].lower()
            if key not in unique_links:
                unique_links[key] = link
            else:
                # Prefer link with anchor text
                if not unique_links[key]["text"] and link["text"]:
                    unique_links[key]["text"] = link["text"]

        return {
            "text": "\n".join(text_parts).strip(),
            "links": list(unique_links.values())
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

# Helper functions for experience level calculation
def parse_date(date_str, current_date_str):
    """
    Parse date string with robust error handling
    Handles: "Feb 2023", "Aug. 2024", "Present", "MM/YYYY", etc.
    Returns (year, month) tuple or None
    """
    if not date_str:
        return None
    
    # Normalize: strip, remove punctuation
    date_str = date_str.strip().replace('.', '').replace(',', '')
    
    # Handle special keywords
    if date_str.lower() in ["present", "current", "ongoing"]:
        try:
            current_date = datetime.strptime(current_date_str, "%B %Y")
            return (current_date.year, current_date.month)
        except:
            now = datetime.now()
            return (now.year, now.month)
    
    # Month mapping (comprehensive)
    month_names = {
        'january': 1, 'jan': 1,
        'february': 2, 'feb': 2,
        'march': 3, 'mar': 3,
        'april': 4, 'apr': 4,
        'may': 5,
        'june': 6, 'jun': 6,
        'july': 7, 'jul': 7,
        'august': 8, 'aug': 8,
        'september': 9, 'sep': 9, 'sept': 9,
        'october': 10, 'oct': 10,
        'november': 11, 'nov': 11,
        'december': 12, 'dec': 12
    }
    
    # Try "Month Year" format first (most common in resumes)
    parts = date_str.split()
    if len(parts) >= 2:
        month_str = parts[0].lower()
        year_str = parts[-1]
        
        if month_str in month_names:
            try:
                year = int(year_str)
                if 1900 <= year <= 2100:
                    return (year, month_names[month_str])
            except ValueError:
                pass
    
    # Try "MM/YYYY" or "MM-YYYY"
    for sep in ['/', '-']:
        if sep in date_str:
            parts = date_str.split(sep)
            if len(parts) == 2:
                try:
                    month = int(parts[0])
                    year = int(parts[1])
                    if 1 <= month <= 12 and 1900 <= year <= 2100:
                        return (year, month)
                except ValueError:
                    pass
    
    # Try "YYYY-MM" ISO format
    if '-' in date_str:
        parts = date_str.split('-')
        if len(parts) == 2:
            try:
                year = int(parts[0])
                month = int(parts[1])
                if 1 <= month <= 12 and 1900 <= year <= 2100:
                    return (year, month)
            except ValueError:
                pass
    
    # Fallback: Try to extract year only (assume month 1)
    if date_str.isdigit() and len(date_str) == 4:
        year = int(date_str)
        if 1900 <= year <= 2100:
            return (year, 1)
    
    # If all parsing attempts fail
    return None

def calculate_role_duration(start_date_str, end_date_str, current_date_str):
    """
    Calculate duration in years between two dates
    Returns (months, years) tuple or None
    """
    start = parse_date(start_date_str, current_date_str)
    end = parse_date(end_date_str, current_date_str)
    
    if not start or not end:
        return None
    
    start_year, start_month = start
    end_year, end_month = end
    
    # Calculate total months
    total_months = (end_year - start_year) * 12 + (end_month - start_month)
    
    # Validation: total_months should be non-negative
    if total_months < 0:
        return None
    
    # Convert to years (round to 2 decimals)
    years = round(total_months / 12, 2)
    
    return (total_months, years)

def calculate_experience_level(qualifying_roles, current_date_str):
    """
    Step 2: Python calculates experience duration and classifies level
    """
    if not qualifying_roles:
        return {
            'experience_level': 'Fresher',
            'total_years': 0.0,
            'total_months': 0,
            'reasoning': 'No qualifying Data Analytics roles found.',
            'calculations': []
        }
    
    # Filter out internships
    non_intern_roles = [r for r in qualifying_roles if not r.get('is_internship', False)]
    
    if not non_intern_roles:
        return {
            'experience_level': 'Fresher',
            'total_years': 0.0,
            'total_months': 0,
            'reasoning': 'No qualifying non-internship Data Analytics roles found.',
            'calculations': []
        }
    
    calculations = []
    total_months = 0
    
    for role in non_intern_roles:
        title = role.get('title', 'Unknown')
        company = role.get('company', 'Unknown')
        start_date = role.get('start_date', '')
        end_date = role.get('end_date', '')
        
        duration = calculate_role_duration(start_date, end_date, current_date_str)
        
        if duration:
            months, years = duration
            total_months += months
            calculations.append({
                'role': f"{title} at {company}",
                'start_date': start_date,
                'end_date': end_date,
                'months': months,
                'years': years
            })
    
    # Calculate total years
    total_years = round(total_months / 12, 2)
    
    # Classify experience level
    if total_years <= 1.00:
        experience_level = 'Fresher'
    elif total_years <= 3.00:
        experience_level = 'Intermediate'
    else:
        experience_level = 'Experienced'
    
    # Build reasoning string
    calc_details = []
    for calc in calculations:
        calc_details.append(f"{calc['role']} ({calc['start_date']} - {calc['end_date']}) = {calc['months']} months = {calc['years']} years")
    
    reasoning = f"Total: {total_months} months = {total_years} years. " + "; ".join(calc_details)
    
    return {
        'experience_level': experience_level,
        'total_years': total_years,
        'total_months': total_months,
        'reasoning': reasoning,
        'calculations': calculations
    }

def clean_date_string(date_str):
    """Normalize date string format"""
    if not date_str:
        return date_str
    
    # Keep special keywords as-is
    if date_str.lower() in ["present", "current", "ongoing"]:
        return date_str
    
    # Remove periods and commas
    cleaned = date_str.replace('.', '').replace(',', '').strip()
    
    # Standardize month abbreviations
    month_map = {
        'Jan': 'Jan', 'January': 'Jan',
        'Feb': 'Feb', 'February': 'Feb',
        'Mar': 'Mar', 'March': 'Mar',
        'Apr': 'Apr', 'April': 'Apr',
        'May': 'May',
        'Jun': 'Jun', 'June': 'Jun',
        'Jul': 'Jul', 'July': 'Jul',
        'Aug': 'Aug', 'August': 'Aug',
        'Sep': 'Sep', 'Sept': 'Sep', 'September': 'Sep',
        'Oct': 'Oct', 'October': 'Oct',
        'Nov': 'Nov', 'November': 'Nov',
        'Dec': 'Dec', 'December': 'Dec'
    }
    
    parts = cleaned.split()
    if len(parts) >= 2:
        month_str = parts[0]
        # Try to normalize month
        for full, abbr in month_map.items():
            if month_str.lower() == full.lower():
                parts[0] = abbr
                break
        return ' '.join(parts)
    
    return cleaned

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
    current_date = datetime.now().strftime("%B %Y")

# -----------------------
# CALL 1a: Experience Identification (Two-Step Approach)
# -----------------------
    def _extract_da_roles():
        """
        Step 1: Use LLM to extract qualifying DA roles
        """
        system_message = f"""
# Role
You are a Data Analytics resume role extractor.

# Task
Extract ALL Data Analytics roles from the resume.

# Workflow
## Step-by-Step Process
1. First, scan the entire resume to identify ALL work experience entries
2. For each entry, check if it meets BOTH criteria (title AND responsibilities)
3. Extract the required fields (title, company, dates)
4. Clean and standardize date formats
5. Flag internships based on title
6. Output in the exact JSON format specified

# Instructions

## What Qualifies as a Data Analytics Role

A role qualifies ONLY if it meets BOTH criteria:
1. **Job Title** contains one of these EXACT keywords or their variations:
   - "Data Analyst", "Data Associate", "Business Analyst", "Analytics", 
   - "Data Scientist", "BI Analyst", "Data Engineer", "Analytics Associate"
   - DO NOT include roles like "Product Manager", "Project Manager", "Software Engineer", "Developer"
   - If title is unclear, check responsibilities in Step 2

2. **Core responsibilities** involve: data analysis, reporting, dashboards, SQL queries, ETL, data pipelines, statistical analysis, or predictive modeling as PRIMARY duties

**Important Distinctions:**
- Product Manager/Program Manager/Project Manager roles that USE data tools (PowerBI, Excel) for decision-making are NOT Data Analytics roles
- Roles where data analysis is a SUPPORTING skill (not the primary function) should NOT be counted
- **CRITICAL: Flag any role with "Intern" in the title as internship (is_internship: true)**

## Decision Logic (Follow Exactly):
- If title clearly matches DA keywords → Include (check responsibilities to confirm)
- If title is ambiguous BUT responsibilities are clearly DA-focused → Include
- If title is NOT DA-related BUT responsibilities mention DA work → DO NOT include
- If title is NOT DA-related AND responsibilities are NOT DA-focused → DO NOT include
- If you cannot determine → DO NOT include (exclude rather than guess)

## Extraction Rules

- Extract role title, company name, start date, and end date
- **CRITICAL DATE FORMAT RULES:**
  - DO NOT include periods: "Aug." → "Aug" (remove period)
  - DO NOT include commas: "Aug, 2024" → "Aug 2024" (remove comma)
  - DO NOT use abbreviations unless standard: Use "Aug" not "August" for months
  - Standardize to format: "Month Year" (e.g., "Aug 2024", "Feb 2023", "January 2022")
  - Keep special keywords as-is: "Present", "Current", "Ongoing" (case-sensitive)
  - DO NOT convert dates to different formats (e.g., don't change "2023-2024" to "Jan 2023 - Dec 2024")
- Flag if the role is an internship (title contains "Intern")
- DO NOT calculate duration, months, or years between dates
- DO NOT classify experience level (Fresher/Intermediate/Experienced)
- DO NOT modify or interpret dates beyond formatting cleanup
- Extract dates EXACTLY as written, only clean formatting (remove periods/commas)

# Output (JSON only)
{{
  "qualifying_roles": [
    {{
      "title": "Data Analyst",
      "company": "Company Name",
      "start_date": "Feb 2023",
      "end_date": "Present",
      "is_internship": false
    }}
  ],
  "non_qualifying_roles": [
    {{
      "title": "Software Engineer",
      "company": "Company X",
      "reason": "Primary focus is software development, not data analytics (max 20 words)"
    }}
  ]
}}
"""

        user_prompt = f"""
Resume:
{resume_text}

Current date: {current_date}

Extract all Data Analytics roles following the criteria above. 
- Extract dates as they appear, then apply date format cleaning rules from the system prompt
- Include ALL required fields for each role
- If a role is missing required information, exclude it from the output
"""

        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=400
        )
        
        return json.loads(response.choices[0].message.content)

    def _analyze_experience_level():
        """
        Call 1a: Complete workflow - Extract roles → Calculate → Classify
        Two-Step Approach: LLM extracts roles, Python calculates duration
        """
        # Step 1: LLM extracts roles (no calculations)
        extraction_result = _extract_da_roles()
        
        # Clean dates in qualifying_roles
        for role in extraction_result.get('qualifying_roles', []):
            role['start_date'] = clean_date_string(role.get('start_date', ''))
            role['end_date'] = clean_date_string(role.get('end_date', ''))
        
        # Step 2: Python calculates experience (100% accurate)
        qualifying_roles = extraction_result.get('qualifying_roles', [])
        
        # Check if Experience section exists (if no roles found and no non-qualifying roles, might be missing section)
        if not qualifying_roles and not extraction_result.get('non_qualifying_roles', []):
            return {
                'experience_level': 'Fresher',
                'experience_considered': [],
                'experience_reasoning': 'Experience section not found in the resume.'
            }
        
        calculation_result = calculate_experience_level(qualifying_roles, current_date)
        
        # Format for output
        experience_considered = [
            f"{calc['role']} ({calc['start_date']} - {calc['end_date']})"
            for calc in calculation_result['calculations']
        ]
        
        return {
            'experience_level': calculation_result['experience_level'],
            'experience_considered': experience_considered,
            'experience_reasoning': calculation_result['reasoning']
        }

    # -----------------------
    # CALL 1b: Skill Analysis
    # -----------------------
    def _analyze_skills(experience_level):
        """Call 1b: Analyze skills (needs experience_level from Call 1a)"""
        # Determine which market skills to use based on experience level
        detected_level = (experience_level or "fresher").lower()
        level_key = "fresher" if "fresh" in detected_level else (
            "intermediate" if "inter" in detected_level else "experienced"
        )
        
        if level_key == "fresher":
            market_top_skills = fresher_top_skills
        elif level_key == "intermediate":
            market_top_skills = intermediate_top_skills
        else:
            market_top_skills = experienced_top_skills

        system_message_skills = """
# Role
You are a Data Analytics skill analyzer. Extract DA-relevant skills and identify curriculum gaps.

# Rules (STRICT):
- Extract ONLY skills that are EXPLICITLY mentioned in the resume text
- DO NOT infer skills from context (e.g., if resume mentions "data analysis" but not "Python", do NOT add "Python")
- DO NOT assume skills based on tools mentioned (e.g., "Power BI dashboard" does NOT imply "DAX" unless DAX is explicitly mentioned)
- Skill name must appear in resume text (exact match or common variation)
- After extraction, apply normalization rules (see Step 1)
- When in doubt about whether a skill is mentioned → EXCLUDE it (do not guess)

# Workflow
## Step-by-Step Process
1. First, scan the entire resume to identify ALL technical skills mentioned
2. For each skill found, verify it is explicitly written (not inferred)
3. Filter out non-DA skills using the exclusion categories
4. Normalize skill names according to the rules
5. Compare normalized skills against curriculum list
6. Identify missing curriculum skills
7. Validate all skills before output
8. Output in the exact JSON format specified

# Instructions:

## Step 1: Extract Skills
- From resume, extract all technical skills mentioned and add to **has_skills** list.
- **CRITICAL: Remove skills that belong to these categories:**
  - Web development: React, Angular, Node.js, Vue, Django, Flask, HTML, CSS, JavaScript (unless used for data viz)
  - Mobile development: Flutter, Swift, Android, iOS, React Native
  - Design tools: Figma, Canva, Adobe Photoshop, Adobe Illustrator (UNLESS explicitly for data visualization)
  - Marketing tools: Meta Suite, Facebook Ads, Instagram Ads, Google Ads, social media platforms
  - Video/Media: Video editing, Premiere Pro, After Effects, Final Cut Pro
  - HR/Other: HR software, CRM tools (unless Salesforce for analytics), non-DA tools
  
  **Decision Logic:**
  - If skill is in exclusion list → Remove
  - If skill is ambiguous (e.g., "JavaScript") → Check context: if used for web dev → Remove, if used for data viz → Keep
  - When in doubt → Remove (exclude rather than include)

- **CRITICAL: Normalize skill names using these EXACT rules:**
  - "MS Excel" / "Microsoft Excel" / "Excel" → "Excel"
  - "MySQL" / "SQL Server" / "MYSQL" / "Sql" → "SQL"
  - "NumPy" / "numpy" / "Numpy" → "NumPy" (keep capitalization)
  - "Pandas" / "pandas" / "PANDAS" → "Pandas" (keep capitalization)
  - "Power BI" / "PowerBI" / "Powerbi" → "Power BI"
  - "Power Query" / "PowerQuery" → "Power Query"
  - DO NOT normalize other skills unless explicitly listed above
  - Preserve original capitalization for skills not in normalization list

## Step 2: Identify Missing Curriculum Skills
- Compare extracted skills against curriculum list. **missing_skills** = in curriculum but NOT in resume.

## Step 3: Validation (MANDATORY - Do this before output)
Before generating JSON output, verify EACH skill:

**For has_skills:**
1. Is the skill name EXPLICITLY written in the resume? (Not inferred)
   - If NO → Remove from has_skills
2. Is it spelled out, not just implied? (e.g., "Python" ≠ "Pandas" unless "pandas" also appears)
   - If NO → Remove from has_skills
3. Is it a technical skill, not a job responsibility? (e.g., "AI product work" ≠ "Generative AI")
   - If NO → Remove from has_skills
4. Is it DA-relevant (not in exclusion categories)?
   - If NO → Remove from has_skills
5. Has it been normalized correctly?
   - If NO → Apply normalization rules

**For missing_skills:**
1. Is the skill in the curriculum list (CURRICULUM_SKILLS_FOCUS)?
   - If NO → Remove from missing_skills
2. Is it NOT in has_skills (after normalization)?
   - If NO → Remove from missing_skills (it's already present)

**DO NOT output until ALL skills pass validation**

# Output (JSON only - NO other format)
{
  "skills_analysis": {
    "has_skills": ["Excel", "SQL", "Python", "Pandas"],
    "missing_skills": ["Power BI", "Statistics"]
  }
}

**CRITICAL OUTPUT RULES:**
- Output MUST be valid JSON (no markdown code blocks, no )
- has_skills: Array of strings (normalized skill names)
- missing_skills: Array of strings (curriculum skill names)
- DO NOT include any explanation, reasoning, or commentary
- DO NOT include skills that failed validation
- If arrays are empty, output: [] (not null or empty string)
"""

        # Extract just skill names from market_top_skills for cleaner prompt
        market_skill_names = [s.split(' (')[0] for s in market_top_skills]

        user_prompt_skills = f"""
Resume: {resume_text}

Experience Level: {experience_level}
Market Top Skills ({level_key}): {', '.join(market_skill_names)}

TASK: Extract all technical skills from resume, then identify ALL missing curriculum skills.

**Step 1: Extract Skills**
- Scan resume for ALL technical skills
- Apply exclusion rules to filter non-DA skills
- Normalize skill names according to system prompt rules
- Add to has_skills array

**Step 2: Identify Missing Skills**
- Compare has_skills against curriculum list: {CURRICULUM_SKILLS_FOCUS}
- List ALL curriculum skills NOT in has_skills
- Add to missing_skills array

**Step 3: Validate**
- Verify each skill in has_skills passes ALL validation checks
- Verify each skill in missing_skills is in curriculum and not in has_skills
- Remove any skills that fail validation

VALIDATION CHECKLIST (verify each skill in has_skills):
1. Is the skill name explicitly written in the resume? (Not inferred from context)
2. Is it spelled out, not just implied? (e.g., "Python" ≠ "Pandas" unless "pandas" also appears)
3. Is it a technical skill, not a job responsibility? (e.g., "AI product work" ≠ "Generative AI")

Only include skills that pass ALL 3 checks."""

        response_skills = client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_message_skills},
                {"role": "user", "content": user_prompt_skills}
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=300
        )
        return json.loads(response_skills.choices[0].message.content)

    # -----------------------
    # CALL 1c: Project Analysis
    # -----------------------
    def _analyze_projects():
        """Call 1c: Analyze projects (independent, can run in parallel with skills)"""
        system_message_projects = """
# Role
You are a Data Analytics resume project evaluator.

# Task
Identify and classify projects from the resume's Projects section.

# Instructions

## Step 1: Check for Projects Section

**CRITICAL: First verify if a dedicated "Projects" section exists.**
- Look for section headers: "Projects", "PROJECTS", "Personal Projects", "Academic Projects", "Portfolio", etc.
- If NO Projects section exists:
  - Output: projects_to_keep = [], projects_to_remove = []
  - DO NOT extract from Experience/Work History
  - DO NOT treat work accomplishments as projects
- If Projects section EXISTS: proceed to Step 2

## Step 2: Evaluate Each Project

For each project listed in the Projects section:

**Projects to KEEP (Data Analytics relevant):**
- Uses SQL, Python, R, or other data tools
- Involves data analysis, visualization, or modeling
- Demonstrates: ETL, dashboards, statistical analysis, ML, data pipelines
- Examples: "E-commerce Analysis using SQL", "Customer Churn Prediction", "Sales Dashboard in Power BI"

**Projects to REMOVE (Not Data Analytics):**
- Full Stack Web/mobile app development
- Pure software engineering
- UI/UX design projects
- Marketing campaigns
- Robotics/embedded systems projects (swarm robotics, Arduino, IoT devices)
- Hardware/firmware projects
- Examples: "Chat Application", "E-commerce Website", "Portfolio Website", "Swarm Robotics", "Arduino IoT Project"

## Step 3: Extract Project Titles Only

**CRITICAL OUTPUT RULES:**
- Extract ONLY the project title/name (5-15 words max)
- DO NOT include full descriptions or bullet points
- DO NOT copy technologies lists
- Keep format consistent: simple string titles only

**Example Output Format:**
```json
{
  "projects_to_keep": [
    "E-commerce Sales Analysis using SQL",
    "Customer Churn Prediction Model",
    "Power BI Sales Dashboard"
  ],
  "projects_to_remove": [
    "Chat Web Application",
    "Portfolio Website",
    "Instagram Marketing Campaign"
  ]
}
```

# Output (JSON only)
{
  "projects_analysis": {
    "projects_to_keep": ["project title 1", "project title 2"],
    "projects_to_remove": ["project title 3"]
  }
}
"""

        user_prompt_projects = f"""
Resume:
{resume_text}

CRITICAL REMINDERS:
1. Check if a dedicated Projects section exists
2. If no Projects section: output empty arrays
3. If Projects section exists: evaluate each project
4. Output ONLY project titles (5-15 words), NO descriptions
5. DO NOT extract from Experience section

Extract project titles following the criteria above.
"""

        response_projects = client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_message_projects},
                {"role": "user", "content": user_prompt_projects}
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=500
        )
        return json.loads(response_projects.choices[0].message.content)

    # Execute calls: 1a first, then 1b and 1c in parallel
    print("Call 1a: Analyzing experience level...")
    experience_result = _analyze_experience_level()
    experience_level = experience_result.get("experience_level", "Fresher")
    experience_considered = experience_result.get("experience_considered", [])
    experience_reasoning = experience_result.get("experience_reasoning", "")
    
    print(f"Call 1a complete. Experience level: {experience_level}")
    print(f"Experience considered: {experience_considered}")
    print(f"Experience reasoning: {experience_reasoning}")
    print("Call 1b & 1c: Running skill and project analysis in parallel...")
    
    # Run calls 1b and 1c in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        skills_future = executor.submit(_analyze_skills, experience_level)
        projects_future = executor.submit(_analyze_projects)
        
        skills_result = skills_future.result()
        projects_result = projects_future.result()
    
    print("Call 1b & 1c complete.")
    print(f"Skills result: {skills_result}")
    print(f"Projects result: {projects_result}")
    
    # Merge all results into gap_analysis
    gap_analysis = {
        **experience_result,
        **skills_result,
        **projects_result
    }

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
  "ats_analysis": {"reasoning": "50 words max"},
  "scores": {"job_relevance_score": 0, "ats_score": 0, "score_reasoning": "35 words max"},
  "job_market_analysis": {
    "jobs_analyzed": <integer>,
    "top_skills": ["Skill (appears in X%) - Demand: ..."]
  },
  "analysis_summary": "35 words max"
}
"""

    # choose market data for detected level
    detected_level = (gap_analysis.get("experience_level") or "fresher").lower()
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

    experience_level = analysis.get('experience_level', 'Unknown')
    print("Analysis complete:")
    print(f"  - User Experience Level: {experience_level}")

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
    PROMPT 1: Strategy Generation
    """
    system_message = """
# Role
You are a resume strategy analyst specializing in Data Analytics roles and Coding Ninjas Data Analytics curriculum.

# Task
Generate skill & project improvement strategy based on gap analysis and curriculum.

# Reasoning
You MUST think step by step and plan your approach before generating the output.
For each decision, explicitly reason through:
1. What skills need enhancement and why (check present_keywords, experience_level)
2. What skills need to be added and why (from missing_skills)
3. What projects should be added/removed and why (match skills, complexity, DA relevance)
4. How modules map to skills and projects (track all relationships)

Think through your reasoning internally before finalizing the JSON output.

# Edge Case Handling
- If a skill in has_skills has no corresponding curriculum module for enhancement → skip it
- If missing_skills contains skills not in curriculum_data → skip those skills (they're already filtered, but be explicit)
- If projects_to_keep has more than 5 projects → still keep all of them, but don't add more (projects_added = [])
- If curriculum_data structure is unexpected → use best judgment but prioritize exact module names

# Workflow (Execute in this exact order)

## Step 1: Skill Enhancement Analysis
1. For each skill in has_skills:
   a. Identify advanced topics from curriculum
   b. Check if advanced topics exist in present_keywords
   c. If missing AND appropriate for experience_level → add to skills_to_enhance
   d. If present → skip

## Step 2: Skill Addition Analysis  
1. If missing_skills is empty → set skills_to_add = []
2. If not empty → map each to curriculum module

## Step 3: Project Removal
1. If projects_to_remove is empty → set projects_removed = []
2. If not empty → list all projects to remove

## Step 4: Project Addition
1. Calculate: projects_needed = 5 - len(projects_to_keep)
2. If projects_needed <= 0 → skip, set projects_added = []
3. If projects_needed > 0 → select case studies matching criteria
4. Remove duplicates from projects_to_keep

## Step 5: Module Tracking
1. For each module used in steps 1-4, create mapping entry
2. Track all skills and projects associated with each module

## Step 6: Validation
1. Verify no skill appears in both enhance AND add
2. Verify Python libraries are categorized correctly
3. Verify all modules are tracked

# Instructions

## 1. Skill Analysis
Use the gap_analysis and curriculum provided:

### a. Identify Skills to Enhance

Examine each skill in has_skills and determine if it can be enhanced with advanced topics from the curriculum:
1. Identify what advanced topics would enhance this skill while ensuring the advanced topics are appropriate for the user's experience_level and align with Data Analytics role requirements
2. Check if those advanced topics are already in present_keywords:
 - If advanced topics are MISSING from present_keywords → add to skills_to_enhance
 - If advanced topics are ALREADY in present_keywords → skip (already covered)
3. Never add basic concepts to skills_to_enhance if experience_level is Intermediate or Experienced.

**Example:**

Given:
- experience_level: "Intermediate"
- has_skills: ["Excel", "SQL", "Python"]
- present_keywords: ["Power Query", "Pandas", "Numpy", "Matplotlib"]

Internal Reasoning:
- Excel → Advanced: "Power Query" → Found in present_keywords → Skip
- SQL → Advanced: "CTEs, Window Functions" → NOT found in present_keywords → Include
- Python → Advanced: "NumPy, Pandas, Matplotlib" → Found in present_keywords → Skip
- Python → Advanced: "Object Oriented Programming (OOP)" → experience_level is Intermediate → Skip

Output:
skills_to_enhance = [{"base": "SQL","enhanced": "Advanced SQL (CTEs, Window Functions)","module": "Analytics with SQL"}]

### b. Identify Skills to Add
Use missing_skills (already filtered to curriculum)
- If missing_skills is empty, then skip this step and move to project strategy and output: skills_to_add = []
- If not then, map each missing skill to its curriculum module using the curriculum_data.

## 2. Project Strategy
Use the projects_analysis provided:

### a. Remove Irrelevant Projects 
If projects_to_remove is empty then skip this step and output: projects_removed = []
- Remove all projects listed in projects_to_remove. These are non-DA projects that add no value

### b. Add Curriculum Case Studies as Projects
Rules:
If projects_to_keep already contains 5 projects then skip this step.
- Case Studies to add = len(5 - len(projects_to_keep))
- Add case studies from curriculum that matches the following criteria:
 - Support skills being added/enhanced which projects_to_keep does not support.
 - Match experience_level complexity: 
  - For 'Fresher': Select foundational case studies
  - For 'Intermediate': Select intermediate-level case studies  
  - For 'Experienced': Select advanced case studies
 - Are most relevant to DA roles: Prioritize case studies that demonstrate skills commonly required in Data Analytics job descriptions (data cleaning, visualization, statistical analysis, SQL queries, dashboard creation) 
- Never add case studies that are already present in projects_to_keep. 

For each case study:
- name: Use exact case study name from curriculum
- module: Module name where case study is from

### c. Keep Relevant Projects
- Retain all projects from projects_to_keep with original description
- These are existing DA-relevant projects
- If projects_to_add & projects_to_keep have same projects then remove the duplicate project from projects_to_add.
- Order: Most relevant to DA first

### Module Tracking
For each module used:
- module: Exact name from curriculum
- addresses_gaps: List specific skills/keywords it addresses
- projects_included: List case studies used as projects
- skills_added_from_module: New skills from this module
- skills_enhanced_by_module: Enhanced skills using this module

# CRITICAL REQUIREMENTS (Must be followed exactly)
1. Each skill MUST appear in ONLY ONE place: either skills_to_enhance OR skills_to_add, NEVER both.
2. Python libraries MUST be treated as enhancements if Python exists in has_skills, otherwise Python itself MUST be added.
3. ALL modules used MUST be tracked in curriculum_mapping with complete information.
4. Projects MUST NOT be duplicated between projects_to_keep and projects_added.
5. Case study names MUST match exactly from curriculum_data (case-sensitive).

# Output Schema (JSON only - ALL fields required)

{
  "skill_strategy": {
    "skills_to_enhance": [  // Array, can be empty []
      {
        "base": "string (required)",  // Original skill name
        "enhanced": "string (required)",  // Enhanced skill description
        "module": "string (required)"  // Exact module name from curriculum
      }
    ],
    "skills_to_add": [  // Array, can be empty []
      {
        "skill": "string (required)",  // Skill name
        "module": "string (required)"  // Exact module name from curriculum
      }
    ]
  },
  "project_strategy": {
    "projects_removed": ["string"],  // Array of project names
    "projects_kept": ["string"],  // Array of project names (preserve order)
    "projects_added": ["string"],  // Array of case study names (exact from curriculum)
    "final_project_count": number  // Total count: len(projects_kept) + len(projects_added)
  },
  "curriculum_mapping": {
    "modules_used": [  // Array, one entry per unique module
      {
        "module": "string (required)",  // Exact module name
        "addresses_gaps": ["string"],  // Array of skill/keyword names
        "projects_included": ["string"],  // Array of case study names
        "skills_added_from_module": ["string"],  // Array of skill names
        "skills_enhanced_by_module": ["string"]  // Array of "base → enhanced" strings
      }
    ]
  }
}"""
    has_skills = gap_analysis.get('skills_analysis', {}).get('has_skills', [])
    missing_skills = gap_analysis.get('skills_analysis', {}).get('missing_skills', [])
    present_keywords = gap_analysis.get('keywords_analysis', {}).get('present_keywords', [])
    experience_level = gap_analysis.get('experience_level', 'Unknown')
    projects_to_remove = gap_analysis.get('projects_analysis', {}).get('projects_to_remove', [])
    projects_to_keep = gap_analysis.get('projects_analysis', {}).get('projects_to_keep', [])
    
    user_prompt = f"""Generate improvement strategy for Data Analytics resume.

## Critical Gap Analysis
- **has_skills:** 
{json.dumps(has_skills)}

- **present_keywords:** 
{json.dumps(present_keywords)}

- **Missing skills:** 
{json.dumps(missing_skills)}

- **User Experience Level:** 
{experience_level}

## Project Info
- **Projects to remove (count={len(projects_to_remove)}):** 
{json.dumps(projects_to_remove)}

- **Projects to keep:** 
{json.dumps(projects_to_keep)}

## Coding Ninjas Curriculum
{json.dumps(curriculum_data, indent=2)}
"""

    # Use retry helper with initial max_tokens=1024, retry with max_tokens=2048
    strategy, retry_attempted = response_retry_helper(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt}
        ],
        response_format={"type": "json_object"},
        temperature=0.0,  # Fully deterministic
        initial_max_tokens=1024,
        retry_max_tokens=1600,
        method_name="prompt_1_strategy_generation"
    )
    
    print("✓ Prompt 1: Strategy generation complete")
    print(f"  - Skills to enhance: {len(strategy.get('skill_strategy', {}).get('skills_to_enhance', []))}")
    print(f"  - Skills to add: {len(strategy.get('skill_strategy', {}).get('skills_to_add', []))}")
    print(f"  - Projects to add: {len(strategy.get('project_strategy', {}).get('projects_added', []))}")
    print(f"  - Modules tracked: {len(strategy.get('curriculum_mapping', {}).get('modules_used', []))}")
    print(json.dumps(strategy, indent=2))
    
    return strategy


def prompt_2_resume_writing(resume_data, strategy, gap_analysis, curriculum_data):
    """
    PROMPT 2: Resume Writing
    """
    system_message = """
    # Role
    You are an ATS resume writer specializing in Data Analytics roles.

    # Task
    Generate an improved ATS-friendly resume utilizing only the provided improvement strategy, original user resume and Curriculum Mapping.

    # Link Usage Rules (CRITICAL)
    You are provided with a list of embedded links extracted from the resume.
    Each link contains:
    - url
    - anchor text (may be empty)

    STRICT RULES:
    1. NEVER invent, modify, shorten, or expand any URL.
    2. Use ONLY the provided links.
    3. If the purpose of a link is unclear, keep it as plain text (do not force placement).
    4. Determine link purpose ONLY using:
    - anchor text
    - nearby resume content
    5. If confidence is low, include the link only in the HEADER (if profile link) or CERTIFICATIONS (if labeled as "Certificate").

    PLACEMENT RULES:
    - LinkedIn / GitHub profile links → HEADER
    - Project repository links → under the corresponding project
    - Certificate links → CERTIFICATIONS section
    - Unknown or irrelevant links → EXCLUDE from resume

    # Template Structure
    Exactly follow this ATS-friendly structure for the improved resume:

    ## HEADER SECTION
    [FULL NAME - from original, all caps]
    Email (if present) | Phone (if present) | Location (if present) | LinkedIn (URL if present) | GitHub (URL if present) | Kaggle (URL if present)
    [Remove contact info which is not present]

    ## PROFESSIONAL SUMMARY
    2 sentences maximum: [Professional Title based on experience_level] with expertise in [top 2-4 skills including enhanced ones], experienced in [domain/projects], seeking to leverage [skills] for [DA role type].

    ## TECHNICAL SKILLS
    • Programming & Languages: [list skills with enhancements grouped]
    • Data Visualization: [Power BI, Excel, etc.]
    • Soft Skills: Communication, Teamwork, Problem Solving, Time Management, etc.
    • Other Tools: [Jupyter, etc.]

    **CRITICAL RULES:**
    - Use these EXACT category names
    - Do NOT combine categories or create new categories beyond the five mentioned above
    - If any category has no values to add, REMOVE the category from the resume

    ## PROFESSIONAL EXPERIENCE
    - Add the professional experience from the original resume as per the experience_considered list, if empty then skip this section.
    
    ### Professional Experience FORMAT (MANDATORY)
    - For professional experience, use the following format for each role:
    If any field is not present, skip it.
     - Company Name | Duration 
     - Role | Location
     - Retain original format of the description.

     Example:
     **Pacer Staffing** | Feb 2023 - Present
     **Data Analyst** | Noida
     For description retain original format.

    ## PROJECTS
    **Structure per project:**
    - For original projects retain original details and use the following format:
     - Project Title | Technologies | Link | Date (skip fields if not present)
     - Retain original description broken into 3 points.
    - For curriculum case studies, use the following format:
     - Case Study Name | Main Technology | (skip fields if not present)
     - 4 points description highlighting caseStudies description. (40 words max for each point)
    
    **CRITICAL:**
    - Find the exact case study name & the corresponding details from the curriculum data provided in the user prompt.
    - NO invented metrics ("processed 50,000 records" if not in original)
    - NO invented outcomes ("increased revenue 15%" if not stated)
    - Use case study details if from curriculum
    - Use original details if from user's resume
    - For improving the skills and projects rely only on the improvement strategy provided.

    ## EDUCATION
    **CRITICAL RULES:**
    1. Include ONLY graduation (Bachelor's) OR post-graduation (Master's) education
    2. EXCLUDE: High school, Class X, Class XII, school education
    3. Format per entry:
    Line 1: University/College name
    Line 2: Degree name | Year range
    Line 3: CGPA/GPA (if present)

    ## CERTIFICATIONS
    - First list all certifications from original resume exactly as they appear
    - Then check if ANY certification contains 'Coding Ninjas' AND 'Data Analytics'
     - If YES: Stop here
     - If NO: Add 'Data Analytics | Coding Ninjas | {CURRENT_YEAR}' as the last entry

    ## FINAL VERIFICATION CHECKLIST (INTERNAL REASONING ONLY)

    Before outputting resume, verify:

    ### Professional Experience:
    - Fresher → section DOES NOT exist
    - Non-Fresher → included only if original had DA-related role

    ### Education:
    - Section name is "Education" (NOT "Academic Details")
    - Exactly copy the graduation or post graduation details from the resume, ignore the school details.

    ### Technical Skills:
    - NO arrows (→) anywhere
    - Skills grouped: "Python (NumPy, Pandas)" not separate
    - skills and projects should be based on the improvement strategy provided.

    ### Projects:
    - NO invented metrics/outcomes
    - All links placed correctly like the original resume
    - 3 bullets per project using templates
    - Removed projects NOT included

    ### Contact Info:
    - All original info preserved
    - All links preserved exactly

    ### No extra text or sections or commentary is present in the resume, if found remove it.

    # Output
    - Generate complete resume text only (no JSON, no reasoning).
    - Use plain text format, NOT markdown code blocks.
"""

    resume_text_content = resume_data.get('text', '')
    resume_links = resume_data.get('links', [])
    experience_level = gap_analysis.get('experience_level', 'Unknown')
    
    # Extract strategy components for clarity
    skills_enhance = strategy.get('skill_strategy', {}).get('skills_to_enhance', [])
    skills_add = strategy.get('skill_strategy', {}).get('skills_to_add', [])
    experience_considered = gap_analysis.get('experience_considered', [])
    projects_remove = strategy.get('project_strategy', {}).get('projects_removed', [])
    projects_keep = strategy.get('project_strategy', {}).get('projects_kept', [])
    projects_add = strategy.get('project_strategy', {}).get('projects_added', [])
    
    user_prompt = f"""Write improved Data Analytics resume.

    ## Original Resume
    {resume_text_content}

    ## Embedded Links (USE EXACTLY AS PROVIDED)
    Each link contains a URL and optional anchor text.
    You must decide placement using the Link Usage Rules.
    {json.dumps(resume_links, indent=2)}

    ## Improvement Strategy

    **Experience Considered:**
    {json.dumps(experience_considered, indent=2)}

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

    ## Curriculum Data (for case study details)
    {json.dumps(curriculum_data, indent=2)}

    ## User Context
    - User Experience Level: {experience_level}
    - Current Year: {CURRENT_YEAR}
    """

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.0,  # Lower for more consistency
        max_tokens=1800
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
- Apply scoring rubrics strictly based on user experience level
- Counts must match strategy exactly
"""

    # Context for scoring
    missing_skills = gap_analysis.get('skills_analysis', {}).get('missing_skills', [])
    total_missing = len(missing_skills)
    experience_level = gap_analysis.get('experience_level', 'Unknown')
    
    # Get market analysis for scoring context
    job_market = gap_analysis.get('job_market_analysis', {})
    top_skills = job_market.get('top_skills', [])
    
    user_prompt = f"""Extract classifications and score improved resume.

## Strategy (SOURCE OF TRUTH for classifications)
{json.dumps(strategy, indent=2)}

## Improved Resume (for scoring only)
{improved_resume_text}

## Context for Scoring
- User Experience Level: {experience_level}
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

def generate_improved_resume(resume_data, gap_analysis, curriculum_text, stop_after_prompt2=False, run_id=None):
    """
    Generate improved resume using prompt chaining (3 sequential prompts).
    
    Args:
        resume_data: Resume data with text and links
        gap_analysis: Analysis from step 2
        curriculum_text: Curriculum text for prompts
        stop_after_prompt2: If True, stop after Prompt 2 and return early
        run_id: Optional run ID for logging
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
    # Set run_id for logging
    if run_id:
        prompt_2_resume_writing._current_run_id = run_id
    improved_resume_text = prompt_2_resume_writing(resume_data, strategy, gap_analysis, curriculum_data)
    
    # If stopping after Prompt 2, return early
    if stop_after_prompt2:
        print("  → Stopping after Prompt 2 (as requested)")
        return {
            "improved_resume_text": improved_resume_text,
            "strategy": strategy,
            "stopped_after_prompt2": True
        }
    
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
        experience_level = original_analysis.get('experience_level', 'Unknown')
        print(f"✓ User Experience Level detected: {experience_level}")
        
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
        
        # Check if we should stop after Prompt 2 (for stability testing)
        stop_after_prompt2 = data.get('stop_after_prompt2', False)
        run_id = data.get('run_id', None)
        
        # Generate improved resume + curriculum mapping (AI Call #2)
        # Pass resume_data (full object with text and links) to LLM
        improved_result = generate_improved_resume(
            resume_data,  # Pass full JSON object containing both text and links
            original_analysis,
            curriculum_text,
            stop_after_prompt2=stop_after_prompt2,
            run_id=run_id
        )
        
        # If stopped after Prompt 2, return early with just the improved text
        if stop_after_prompt2:
            return jsonify({
                "improved_resume_text": improved_result['improved_resume_text'],
                "run_id": run_id,
                "stopped_after_prompt2": True
            })
        
        # Extract curriculum mapping and improved resume from result
        curriculum_mapping = improved_result['curriculum_mapping']
        improved_resume = improved_result['improved_resume']
        modification_summary = improved_result.get('modification_summary', '')
        
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
                "experience_level": original_analysis.get('experience_level', ''),
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