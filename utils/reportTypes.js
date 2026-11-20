const REPORT_TYPES = Object.freeze({
    "Compte-rendu": "Compte-rendu opérationnel",
    "Rapport d'incident": "Rapport d'incident",
    "Rapport de vadrouille": "Rapport de vadrouille",
    "Rapport de tir": "Rapport de tir",
    "Rapport d'altercation": "Rapport d'altercation",
    "Dossier": "Dossier de groupe"
})

const REPORT_TYPE_OPTIONS = Object.entries(REPORT_TYPES)
    .filter(([type])=>type !== "Dossier")
    .map(([value, label])=>({value, label}))

function isValidOperationalReportType(type){
    return REPORT_TYPE_OPTIONS.some(option=>option.value === type)
}

function reportTypeLabel(type){
    return REPORT_TYPES[type] || REPORT_TYPES["Compte-rendu"]
}

module.exports = {
    REPORT_TYPE_OPTIONS,
    isValidOperationalReportType,
    reportTypeLabel
}
