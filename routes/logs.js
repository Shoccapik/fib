const express = require("express")
const router = express.Router()
const db = require("../config/database")

const PAGE_SIZE = 30
const logCategories = [
    {value: "all", label: "Tous les événements"},
    {value: "connection", label: "Connexions"},
    {value: "account", label: "Comptes et accès"},
    {value: "report", label: "Rapports"},
    {value: "citizen", label: "Citoyens"},
    {value: "service", label: "Service"},
    {value: "other", label: "Autres événements"}
]

function isAdmin(req, res, next){
    if(!req.session.user || req.session.user.accreditation > 2){
        return res.send("Accès refusé")
    }
    next()
}

function formatLogAction(action){
    return String(action || "").replace(/\*\*([^*]+)\*\*/g, (match, value)=>{
        const date = new Date(value.trim())
        if(value.includes("GMT") && !Number.isNaN(date.getTime())){
            return date.toLocaleDateString("fr-FR", {timeZone: "UTC"})
        }
        return value
    })
}

function getQueryValue(value, maxLength){
    return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function isValidDate(value){
    if(!value) return true
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function getCategoryCondition(category){
    const patterns = {
        connection: ["%connexion%"],
        account: ["%inscrit%", "%utilisateur%", "%compte%"],
        report: ["%rapport%"],
        citizen: ["%citoyen%"],
        service: ["%service%"]
    }

    if(category === "all") return null

    if(category === "other"){
        const allPatterns = Object.values(patterns).flat()
        return {
            sql: `COALESCE(action, '') NOT LIKE ${allPatterns.map(()=>"?").join(" AND COALESCE(action, '') NOT LIKE ")}`,
            params: allPatterns
        }
    }

    const categoryPatterns = patterns[category]
    if(!categoryPatterns) return null
    return {
        sql: `(${categoryPatterns.map(()=> "action LIKE ?").join(" OR ")})`,
        params: categoryPatterns
    }
}

function buildPageUrl(page, filters){
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value])=>{
        if(value) params.set(key, value)
    })
    params.set("page", String(page))
    return `/logs/admin?${params.toString()}`
}

router.get("/admin", isAdmin, (req,res)=>{
    const categoryValues = logCategories.map(category=>category.value)
    const filters = {
        q: getQueryValue(req.query.q, 100),
        category: getQueryValue(req.query.category, 30),
        authorization: getQueryValue(req.query.authorization, 20),
        from: getQueryValue(req.query.from, 10),
        to: getQueryValue(req.query.to, 10)
    }
    const authorizationValues = ["all", "ACCORDEE", "REFUSEE", "unspecified"]

    if(!categoryValues.includes(filters.category)) filters.category = "all"
    if(!authorizationValues.includes(filters.authorization)) filters.authorization = "all"
    if(!isValidDate(filters.from) || !isValidDate(filters.to)){
        return res.status(400).send("Format de date invalide")
    }
    if(filters.from && filters.to && filters.from > filters.to){
        return res.status(400).send("La date de début doit précéder la date de fin")
    }

    const conditions = []
    const params = []
    if(filters.q){
        const query = filters.q.toLocaleLowerCase("fr-FR")
        conditions.push(`(
            LOCATE(?, LOWER(COALESCE(action, ''))) > 0
            OR LOCATE(?, LOWER(COALESCE(actor_username, ''))) > 0
            OR LOCATE(?, LOWER(COALESCE(target_type, ''))) > 0
            OR LOCATE(?, CAST(id AS CHAR)) > 0
        )`)
        params.push(query, query, query, query)
    }

    const categoryCondition = getCategoryCondition(filters.category)
    if(categoryCondition){
        conditions.push(categoryCondition.sql)
        params.push(...categoryCondition.params)
    }

    if(filters.authorization === "unspecified"){
        conditions.push("(authorization IS NULL OR authorization = '')")
    }else if(filters.authorization !== "all"){
        conditions.push("authorization = ?")
        params.push(filters.authorization)
    }

    if(filters.from){
        conditions.push("created_at >= ?")
        params.push(filters.from)
    }
    if(filters.to){
        conditions.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)")
        params.push(filters.to)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
    const summaryQuery = `
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(authorization = 'ACCORDEE'), 0) AS authorized,
            COALESCE(SUM(authorization = 'REFUSEE'), 0) AS denied
        FROM logs
        ${whereClause}`

    db.query(summaryQuery, params, (summaryErr, summaryRows)=>{
        if(summaryErr) return res.status(500).send("Impossible de charger les statistiques des journaux")

        const summary = summaryRows[0] || {total: 0, authorized: 0, denied: 0}
        const total = Number(summary.total) || 0
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        const requestedPage = Number.parseInt(getQueryValue(req.query.page, 10), 10)
        const currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0
            ? Math.min(requestedPage, totalPages)
            : 1
        const offset = (currentPage - 1) * PAGE_SIZE

        db.query(
            `SELECT id, action, actor_username, authorization, target_type, created_at
            FROM logs
            ${whereClause}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?`,
            [...params, PAGE_SIZE, offset],
            (logsErr, results)=>{
                if(logsErr) return res.status(500).send("Impossible de charger les journaux")

                const logs = (results || []).map(log=>({
                    ...log,
                    display_action: formatLogAction(log.action)
                }))
                const firstEntry = total ? offset + 1 : 0
                const lastEntry = Math.min(offset + logs.length, total)

                res.render("admin_logs", {
                    logs,
                    user: req.session.user,
                    filters,
                    logCategories,
                    summary,
                    total,
                    currentPage,
                    totalPages,
                    firstEntry,
                    lastEntry,
                    previousPageUrl: currentPage > 1 ? buildPageUrl(currentPage - 1, filters) : null,
                    nextPageUrl: currentPage < totalPages ? buildPageUrl(currentPage + 1, filters) : null
                })
            }
        )
    })
})

module.exports = router