#!/usr/bin/env python3
"""
Run Step 3 API 10 times using provided full_analysis and resume text. Saves all responses.
"""
import json
import requests
import time
from pathlib import Path
from datetime import datetime

API_URL = "http://localhost:5000/api/generate-improved-resume"

RESUME_TEXT = """MAHIMA MALHOTRA
Email: mahima28.malhotra@gmail.com
Mob.: 9899829190
A dedicated,hardworking,team-oriented professional capable of working cross-functionally and cross-culturally.Very fast  learner
and confident towards delivering the best outputs for Organizational growth. Have good analytical and decision making skills with
critical thinking capabilities in high pressure environment.
ACADEMIC DETAILS
Course
Institute / Organization
Board /
University
Year
% age/CGPA
B.Tech (Instrumentation
and Control Engineering)
Bharati Vidyapeeth's College of  Engineering,
New Delhi
GGSIPU
2016-20
82.9%
Class XII
Rukmini Devi Public School,  New Delhi
CBSE
2015-16
88.47%
Class X
Rukmini Devi Public School,  New Delhi
CBSE
2013-14
10.0
WORK EXPERIENCE\\TRAININGS
Nov 2020 – Present Instrument and Controls Engineer – Mcdermott, Gurugram
•
Working on an EPC based Project- Polyethylene Plant, Borstar Bay3, Texas.
•
Considerable knowledge of Industrial Instruments,Control Systems,Signals,Wiring and
Loops.
•
Worked on Instrument Index,P&IDs , Datasheets (technical specification for instruments), Loop
Diagrams.
•
Worked on Softwares like Smart plant Instrumentation , AutoCad.
June 2019- July 2019     Industrial training – Indian Oil Corporation limited (Pipelines Division) – Noida
•
Reviewed P&IDs
•
Industrial Instruments functionalities, working and Control System Monitoring.
•
Knowledge of SCADA and PLC systems
June 2018-July 2018 Machine Learning and Artificial Intelligence Training – Eckovation, New Delhi
•
Image Classification Using the concept of Convolutional Neural Networks (deep learning)
June 2018-Sept 2018     Java Training - Coding Ninjas, New Delhi
TECHNICAL SKILLS
• Technical Skills           : Java,SQL,Python,Machine Learning,Industrial Instrumentation,Control Systems
• Software Knowledge : Smart Plant Instrumentation, AutoCad, Eclipse IDE, MATLAB, MS Excel,Jupyter
ENGINEERING PROJECTS
•
Pneumonia detection from Chest X-ray images using Deep Learning.
•
Relative localization using the concept of  Swarm Robotics .
•
Smart Urban Farming – Automatic Rooftop Using Arduino Uno
CERTIFICATIONS
• Certification in Industrial Instrumentation  – Indian Oil Corporation Limited
• Certification in JAVA - Coding Ninjas
• Certification in Machine Learning and Artificial Intelligence - Eckovation
• Certification for Event Coordinator – Industrial Society for automation
PERSONAL INTERESTS
•
Likes to play football, badminton and chess
•
Enjoy cooking and like to explore different cafes and food.
•
Binge watch Thriller movies and web series
•
Love cycling, travelling and trekking."""

FULL_ANALYSIS = {
    "analysis_summary": "The resume demonstrates foundational data analytics skills and relevant projects but lacks key market-demanded tools like Power BI and Pandas; ATS compatibility is decent but could improve with consistent formatting.",
    "ats_analysis": {
        "reasoning": "The resume uses a simple single-column layout with standard fonts and clear section headers, but inconsistent date formats and some formatting issues reduce ATS parsing efficiency."
    },
    "experience_reasoning": "The candidate has no explicit work experience in Data Analytics roles. The only relevant experience is an ongoing Instrument and Controls Engineer role since Nov 2020, which is not a Data Analytics position. Trainings and projects related to Machine Learning and Python are present but no explicit DA job duration. Hence, experience is considered ≤1 year, classifying as Fresher.",
    "job_market_analysis": {
        "jobs_analyzed": 89,
        "top_skills": [
            "Excel (appears in 91.01%) - Demand: Critical",
            "SQL (appears in 76.40%) - Demand: Critical",
            "Power BI (appears in 32.58%) - Demand: Essential",
            "Python (appears in 29.21%) - Demand: Essential",
            "NumPy (appears in 3.37%) - Demand: Growing",
            "Pandas (appears in 3.37%) - Demand: Growing",
            "Matplotlib (appears in 3.37%) - Demand: Growing",
            "Seaborn (appears in 3.37%) - Demand: Growing",
            "Machine Learning (appears in 1.12%) - Demand: Growing"
        ]
    },
    "keywords_analysis": {
        "missing_keywords": ["Power BI", "NumPy", "Pandas", "Matplotlib", "Seaborn"],
        "present_keywords": ["Java", "SQL", "Python", "Machine Learning", "Excel", "MATLAB", "MS Excel", "Jupyter"]
    },
    "projects_analysis": {
        "projects_to_keep": ["Pneumonia detection from Chest X-ray images using Deep Learning"],
        "projects_to_remove": ["Relative localization using the concept of Swarm Robotics", "Smart Urban Farming – Automatic Rooftop Using Arduino Uno"]
    },
    "scores": {
        "ats_score": 75,
        "job_relevance_score": 65,
        "score_reasoning": "Strong presence of core skills and relevant projects boosts job relevance, but missing key analytics tools and limited direct experience lower the score; ATS score is good due to simple layout but affected by inconsistent formatting."
    },
    "skills_analysis": {
        "has_skills": ["Java", "SQL", "Python", "Machine Learning", "Excel", "MATLAB", "MS Excel", "Jupyter"],
        "missing_skills": ["Power BI", "NumPy", "Pandas", "Matplotlib", "Seaborn"]
    },
    "user_level": "Fresher"
}

def run_api_call(call_number):
    try:
        print(f"Call {call_number}/10...", end=" ", flush=True)
        start = time.time()
        payload = {
            "resume_data": {"text": RESUME_TEXT, "links": []},
            "full_analysis": FULL_ANALYSIS
        }
        resp = requests.post(
            API_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=90
        )
        elapsed = time.time() - start
        resp.raise_for_status()
        print(f"✓ ({elapsed:.1f}s)")
        return resp.json()
    except Exception as e:
        print(f"✗ Error: {e}")
        return None

def main():
    print("="*70)
    print("Step 3 API Test - 10 Calls")
    print("="*70)
    print()

    output_file = Path(__file__).parent / "step3_responses_10_calls.json"

    all_responses = []
    successful = 0
    failed = 0

    for i in range(1, 11):
        result = run_api_call(i)
        if result:
            all_responses.append({
                "call_number": i,
                "timestamp": datetime.now().isoformat(),
                "response": result
            })
            successful += 1
        else:
            failed += 1
        if i < 10:
            time.sleep(0.3)

    output_data = {
        "test_info": {
            "total_calls": 10,
            "successful_calls": successful,
            "failed_calls": failed,
            "test_timestamp": datetime.now().isoformat()
        },
        "responses": all_responses
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    print()
    print("="*70)
    print("Test Complete!")
    print(f"  Successful: {successful}/10")
    print(f"  Failed: {failed}/10")
    print(f"  Responses saved to: {output_file}")
    print("="*70)

if __name__ == "__main__":
    main()
