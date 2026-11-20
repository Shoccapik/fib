const REPORT_LEVEL_LABELS = Object.freeze({
    1: "Public",
    2: "Confidentiel",
    3: "Secret",
    4: "Très secret"
})

function reportAccessCondition(alias = "r"){
    return `(${alias}.agent_id = ? OR ${alias}.level <= ?)`
}

function reportAccessParams(user){
    return [user.id, 5 - Number(user.accreditation)]
}

function reportLevelLabel(level){
    return REPORT_LEVEL_LABELS[Number(level)] || "Non renseigné"
}

function isValidReportLevel(level){
    return Number.isInteger(Number(level)) && Number(level) >= 1 && Number(level) <= 4
}

module.exports = {
    REPORT_LEVEL_LABELS,
    reportAccessCondition,
    reportAccessParams,
    reportLevelLabel,
    isValidReportLevel
}
