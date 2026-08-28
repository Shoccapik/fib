const express = require("express")
const router = express.Router()
const db = require("../config/database")

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

router.get("/admin", isAdmin, (req,res)=>{
    db.query("SELECT * FROM logs ORDER BY created_at DESC", (err, results)=>{
        if(err) return res.send("Erreur")
        const logs = (results || []).map(log=>({
            ...log,
            display_action: formatLogAction(log.action)
        }))
        res.render("admin_logs", {logs, user: req.session.user})
    })
})

module.exports = router