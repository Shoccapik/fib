const express = require("express")
const router = express.Router()
const db = require("../config/database")

function isAdmin(req, res, next){
    if(!req.session.user || req.session.user.accreditation > 2){
        return res.send("Accès refusé")
    }
    next()
}

router.get("/admin", isAdmin, (req,res)=>{
    db.query("SELECT * FROM logs ORDER BY created_at DESC", (err, results)=>{
        if(err) return res.send("Erreur")
        res.render("admin_logs", {logs: results, user: req.session.user})
    })
})

module.exports = router