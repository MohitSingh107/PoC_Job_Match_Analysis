import React from 'react';

const SkillGapsUI = () => {
  const skills = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
        </svg>
      ),
      name: 'Data Visualization',
      priority: 'High Priority',
      priorityColor: 'text-red-600 bg-red-50'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      name: 'Advanced SQL',
      priority: 'High Priority',
      priorityColor: 'text-red-600 bg-red-50'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
      name: 'Cloud Platforms (AWS/Azure)',
      priority: 'High Priority',
      priorityColor: 'text-red-600 bg-red-50'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" strokeWidth={2} />
          <circle cx="12" cy="12" r="8" strokeWidth={2} />
          <circle cx="12" cy="12" r="11" strokeWidth={2} />
        </svg>
      ),
      name: 'Machine Learning Concepts',
      priority: 'Medium Priority',
      priorityColor: 'text-orange-600 bg-orange-50'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      name: 'Statistical Analysis',
      priority: 'Medium Priority',
      priorityColor: 'text-orange-600 bg-orange-50'
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      name: 'Version Control (Git)',
      priority: 'Low Priority',
      priorityColor: 'text-orange-400 bg-orange-50'
    }
  ];

  return (
    <div className="max-w-7xl mx-auto p-8 bg-white">
      <h1 className="text-4xl font-bold text-gray-900 mb-8">
        Detailed Insights & Next Steps
      </h1>
      
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">
        Your Skill Gaps Prioritized
      </h2>
      
      <div className="space-y-4">
        {skills.map((skill, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-6 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="text-gray-600">
                {skill.icon}
              </div>
              <span className="text-lg text-gray-900">
                {skill.name}
              </span>
            </div>
            
            <span className={`px-3 py-1 rounded-md text-sm font-medium ${skill.priorityColor}`}>
              {skill.priority}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkillGapsUI;