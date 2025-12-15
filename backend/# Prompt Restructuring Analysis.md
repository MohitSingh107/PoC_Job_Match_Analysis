# Prompt Restructuring Analysis

## Current Problem

### Cognitive Load Assessment
The current prompt asks the LLM to do **4 major tasks** in a single pass:

1. **Experience Level Identification** (with date calculations)
2. **Market Analysis & Gap Identification** (skills + projects)
3. **Resume Analysis & Recommendations** (keywords + ATS)
4. **Scoring** (2 different scores with complex rubrics)

**Total cognitive operations: ~15-20 sub-tasks**

### Why This Causes Issues

1. **Attention Dilution:** By task 3-4, the LLM may "forget" strict requirements from task 1
2. **Context Switching:** Jumping between analysis types reduces accuracy
3. **Validation Fatigue:** Multiple validation checkpoints in one prompt get ignored
4. **Error Compounding:** Mistakes in early steps cascade to later steps

## Recommended Approach: Option 2 (Two-Phase)

### Why This Works Best

1. **Optimal Balance:** 2 API calls vs accuracy tradeoff
2. **Clear Separation:** "What do they have/need?" vs "How well is it presented?"
3. **Manageable Complexity:** Each prompt is ~50% of current length
4. **Validation Point:** Can check gaps before scoring

---

## Redesigned Prompt Structure

### CALL 1: Gap Analysis Prompt

```markdown
# Role
You are a Data Analytics resume gap analyzer.

# Task
Analyze the resume and identify what the candidate has vs what they need.

# Instructions (3 steps only)

## Step 1: Determine Experience Level
[Focused date calculation logic - 1 task]

## Step 2: Analyze Skills
[Focused skill extraction + curriculum filtering - 1 task]

## Step 3: Evaluate Projects  
[Focused project relevance check - 1 task]

# Output (JSON)
{
  "user_level": "...",
  "experience_reasoning": "...",
  "skills_analysis": {...},
  "projects_analysis": {...}
}
```

**Key Points:**
- ~40% of original prompt length
- 3 clear sequential steps
- Single focus: "What's the gap?"
- No scoring, no ATS analysis yet

---

### CALL 2: Assessment & Scoring Prompt

```markdown
# Role  
You are a Data Analytics resume evaluator and ATS expert.

# Context (from Call 1)
- User Level: {user_level}
- Skills Gap: {skills_analysis}
- Projects: {projects_analysis}

# Task
Evaluate resume quality and calculate scores.

# Instructions (3 steps only)

## Step 1: Keyword Analysis
[Check keyword presence vs market data]

## Step 2: ATS Compatibility  
[Format and structure assessment]

## Step 3: Calculate Scores
[Apply rubrics based on user level]

# Output (JSON)
{
  "keywords_analysis": {...},
  "ats_analysis": {...},
  "scores": {...},
  "job_market_analysis": {...},
  "analysis_summary": "..."
}
```

**Key Points:**
- ~40% of original prompt length
- 3 clear sequential steps
- Single focus: "How well is it done?"
- Uses output from Call 1 as context

---

## Specific Improvements for Skill Analysis

Even within Call 1, we can simplify the skill analysis section:

### Current (Too Complex):
```
- Step 1: Define curriculum
- Step 2: Extract market skills
- Step 3: Extract user skills
- Step 4: Identify missing (preliminary)
- Step 5: Apply curriculum filter
- Step 6: Validate
```
**6 steps = high cognitive load**

### Simplified (Cognitive-Friendly):
```
## Step 2: Analyze Skills

### 2a. Extract Skills
- Scan resume for all technical skills
- Normalize names (MS Excel → Excel)
- Save to "has_skills"

### 2b. Identify Missing Skills
- Compare against market top 10 skills (provided)
- Keep only skills NOT in "has_skills"
- Filter using CURRICULUM_SKILLS list (provided below)
  
CURRICULUM_SKILLS = [Excel, Power BI, SQL, MySQL, Python, 
NumPy, Pandas, Matplotlib, Seaborn, Statistics, EDA, 
Power Query, DAX, Generative AI]

REMOVE if not in CURRICULUM_SKILLS: R, Azure, AWS, GCP, 
ETL, Data Studio, etc.

### 2c. Final Check
- No skill in "missing_skills" should be in "has_skills"
- All skills in "missing_skills" must be in CURRICULUM_SKILLS
```

**Key simplifications:**
1. Pre-provide the CURRICULUM_SKILLS list (don't make LLM extract it)
2. Pre-provide the market top 10 (don't make LLM select from 27 skills)
3. Combine "preliminary + filter" into one step
4. Reduce 6 steps to 3 sub-steps (2a, 2b, 2c)

---

## Implementation Strategy

### Phase 1: Split the Prompt (Immediate)
```python
def analyze_resume(resume_text):
    # Call 1: Gap Analysis
    gaps = call_llm(
        prompt=gap_analysis_prompt,
        context={
            "resume": resume_text,
            "curriculum": curriculum_json,
            "market_data": market_data_json
        }
    )
    
    # Validate gaps output
    if not validate_gaps(gaps):
        return error
    
    # Call 2: Assessment & Scoring  
    assessment = call_llm(
        prompt=assessment_prompt,
        context={
            "resume": resume_text,
            "gaps": gaps,  # Pass output from Call 1
            "market_data": market_data_json,
            "scoring_rubric": scoring_rubric
        }
    )
    
    # Merge outputs
    return {**gaps, **assessment}
```

### Phase 2: Optimize Each Prompt (Week 2)
- A/B test different phrasings for each call
- Measure accuracy per task
- Refine validation logic

### Phase 3: Add Pre-processing (Optional, Week 3)
- If accuracy still has issues, add extraction layer
- Use cheaper model for extraction
- Use smarter model for analysis




