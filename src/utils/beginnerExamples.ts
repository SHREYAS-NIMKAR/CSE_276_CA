export type BeginnerExampleKey = 'ready' | 'needs_fixes' | 'exception';

export interface BeginnerExampleInfo {
  key: BeginnerExampleKey;
  title: string;
  projectName: string;
  summary: string;
  outcomeLabel: string;
  outcomeTone: 'ready' | 'blocked' | 'attention';
  missingnessText: string;
  fairnessGapText: string;
  whatYouLearn: string;
  prefill: {
    name: string;
    description: string;
    targetPopulation: string;
    autonomy: 'advisory' | 'automated_action';
    sensitivity: 'low' | 'medium' | 'high';
    affectsAcademicStanding: boolean;
    usesSyntheticData: boolean;
    usesThirdPartyWrapper: boolean;
    isLowRiskAdminScript: boolean;
  };
}

export const BEGINNER_EXAMPLES: BeginnerExampleInfo[] = [
  {
    key: 'ready',
    title: 'Example 1: Ready to Release (100%)',
    projectName: 'Study Planner Recommendation Assistant (Demo)',
    summary:
      'An advisory course-scheduling helper where all 21 documents are verified, dataset missingness is low, and student subgroup fairness passes.',
    outcomeLabel: 'Cleared (100% Ready)',
    outcomeTone: 'ready',
    missingnessText: '1.4% (passes <= 5%)',
    fairnessGapText: '1.8% (passes <= 5%)',
    whatYouLearn:
      'See what a complete, passing project looks like and test downloading a signed PDF or CSV readiness report.',
    prefill: {
      name: 'Study Planner Recommendation Assistant',
      description:
        'Advisory study planner suggesting weekly course revision blocks based on syllabus deadlines, with human student confirmation on every recommendation.',
      targetPopulation: 'Undergraduate students and academic advisors',
      autonomy: 'advisory',
      sensitivity: 'low',
      affectsAcademicStanding: false,
      usesSyntheticData: false,
      usesThirdPartyWrapper: false,
      isLowRiskAdminScript: false,
    },
  },
  {
    key: 'needs_fixes',
    title: 'Example 2: Needs Fixes (Practice Repairing)',
    projectName: 'Scholarship Essay Screener (Demo — Needs Fixes)',
    summary:
      'An automated screening model with realistic beginner mistakes: high missing data, uneven accuracy across student groups, and an expired approval.',
    outcomeLabel: 'Not Ready (Blocked)',
    outcomeTone: 'blocked',
    missingnessText: '9.2% (fails > 5%)',
    fairnessGapText: '11.0% (fails > 5%)',
    whatYouLearn:
      'Click "Check my project", read the Overall Suggestion steps, and practice fixing missingness, fairness, and evidence items one by one.',
    prefill: {
      name: 'Scholarship Essay Screener',
      description:
        'Automated first-pass triage assistant scoring scholarship essays before human committee review.',
      targetPopulation: 'Scholarship applicants across domestic and international cohorts',
      autonomy: 'automated_action',
      sensitivity: 'high',
      affectsAcademicStanding: true,
      usesSyntheticData: false,
      usesThirdPartyWrapper: false,
      isLowRiskAdminScript: false,
    },
  },
  {
    key: 'exception',
    title: 'Example 3: Third-Party Wrapper (Exception Flow)',
    projectName: 'Campus FAQ Chatbot Wrapper (Demo — Exception Flow)',
    summary:
      'A handbook Q&A assistant built on an external LLM API with synthetic training examples where raw model weights are unavailable.',
    outcomeLabel: 'Needs Review (Exception)',
    outcomeTone: 'attention',
    missingnessText: '2.0% (passes <= 5%)',
    fairnessGapText: '3.1% (passes <= 5%)',
    whatYouLearn:
      'See how temporary Exceptions work when a project uses synthetic data or an external API wrapper.',
    prefill: {
      name: 'Campus FAQ Chatbot Wrapper',
      description:
        'Conversational Q&A helper answering campus housing and registration handbook questions via a third-party language model API.',
      targetPopulation: 'Incoming students and advising staff',
      autonomy: 'advisory',
      sensitivity: 'low',
      affectsAcademicStanding: false,
      usesSyntheticData: true,
      usesThirdPartyWrapper: true,
      isLowRiskAdminScript: false,
    },
  },
];

export interface ParameterGuideRow {
  parameter: string;
  limit: string;
  plainMeaning: string;
  whereToTest: string;
}

export const PARAMETER_GUIDE: ParameterGuideRow[] = [
  {
    parameter: 'Dataset Missingness %',
    limit: '<= 5.0% (default)',
    plainMeaning:
      'How much data is blank or missing in your Schema Profile. Too many blanks make predictions unreliable.',
    whereToTest: 'Evidence -> Stage 1: Schema Profile',
  },
  {
    parameter: 'Subgroup Fairness Gap',
    limit: '<= 5.0% difference',
    plainMeaning:
      'Difference between your highest and lowest performing student groups (for example, Domestic vs. International students).',
    whereToTest: 'Evidence -> Stage 3 Fairness Check',
  },
  {
    parameter: 'Mandatory Blocking Items',
    limit: 'All Verified',
    plainMeaning:
      'Critical safety files (such as Subgroup Error Matrix and Rollback Plan) that must be submitted and verified before release.',
    whereToTest: 'Evidence (stages 1 to 6)',
  },
  {
    parameter: 'Approval Expiry Dates',
    limit: 'Not expired',
    plainMeaning:
      'Approvals like Ethics Board Sign-Off expire over time. An expired approval automatically locks release until renewed.',
    whereToTest: 'Evidence -> Expiry Date field',
  },
  {
    parameter: 'High-Severity Risks',
    limit: '0 open',
    plainMeaning:
      'Serious safety or fairness gaps flagged by the rule engine. Clear them by verifying evidence, approving an exception, or formal risk sign-off.',
    whereToTest: 'Risks and Guidance / Review',
  },
  {
    parameter: 'Human Sign-Off',
    limit: 'Reviewer cleared',
    plainMeaning:
      'Even at 100%, a human Reviewer or Admin must record final sign-off before status becomes Cleared for Controlled Release.',
    whereToTest: 'Review and Exceptions tab',
  },
];
