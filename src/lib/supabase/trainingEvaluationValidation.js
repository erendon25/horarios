export function evaluationResponseKeys({ generalPoints, stationCode, stationPoints, knowledgePoints = [] }) {
    const general = generalPoints.flatMap(section =>
        section.points.map(point => `${section.id}_${point.id}`)
    );
    const station = stationPoints.map(point => `${stationCode}_${point.id}`);
    const knowledge = knowledgePoints.map(point => `knowledge_${point.id}`);
    return [...general, ...station, ...knowledge];
}

export function missingEvaluationResponses(responses, expectedKeys) {
    return expectedKeys.filter(key => typeof responses[key] !== 'boolean');
}

export function evaluationScoreForKeys(responses, expectedKeys) {
    if (expectedKeys.length === 0) return 0;
    const passed = expectedKeys.filter(key => responses[key] === true).length;
    return Math.round((passed * 100) / expectedKeys.length);
}

export function evaluationPointCatalog({ generalPoints, stationCode, stationTitle, stationPoints, knowledgePoints = [] }) {
    const catalog = new Map();
    generalPoints.forEach(section => {
        section.points.forEach(point => catalog.set(`${section.id}_${point.id}`, {
            section: section.title,
            text: point.text,
        }));
    });
    stationPoints.forEach(point => catalog.set(`${stationCode}_${point.id}`, {
        section: stationTitle,
        text: point.text,
    }));
    knowledgePoints.forEach(point => catalog.set(`knowledge_${point.id}`, {
        section: 'Manejo de situaciones',
        text: point.text,
    }));
    return catalog;
}
