// Keep competition achievements separate so corrections preserve independent training.
export function trainingRecognition(row) {
  const certifications = row.competition_recognition?.certifications || {};
  const baseTrainingScores = row.training_scores || {};
  const baseSkills = row.position_abilities || [];
  return {
    baseTrainingScores,
    baseSkills,
    trainingScores: { ...baseTrainingScores, ...certifications },
    skills: [...new Set([...baseSkills, ...Object.keys(certifications)])],
    competitionCertifications: certifications,
    championships: row.competition_recognition?.championships || [],
  };
}
