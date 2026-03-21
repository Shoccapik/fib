const express = require("express")
const router = express.Router()
const db = require("../config/database")

function isAdmin(req, res, next){
    if(!req.session.user || req.session.user.accreditation > 2){
        return res.send("Accès refusé")
    }
    next()
}

router.get("/", (req,res)=>{
    res.send("Users page")
})

router.get("/admin", isAdmin, (req,res)=>{
    db.query("SELECT id, username, grade_title, accreditation FROM users", (err, results)=>{
        if(err) return res.send("Erreur")
        res.render("admin_users", {users: results, user: req.session.user})
    })
})

router.post("/admin/update", isAdmin, (req,res)=>{
    const {userId, grade_title, accreditation} = req.body

    const gradeLevels = {
        "Director": 1,
        "Deputy Director": 1,
        "Associate Deputy Director": 1,
        "Special Agent In Charge": 2,
        "Assistant Special Agent In Charge": 2,
        "Deputy Special Agent In Charge": 2,
        "Supervisory Special Agent": 2,
        "Special Agent": 3,
        "Probation Agent": 4
    }

    const computedAccreditation = gradeLevels[grade_title] || accreditation || 4

    db.query("UPDATE users SET grade_title = ?, accreditation = ? WHERE id = ?", [grade_title, computedAccreditation, userId], (err)=>{
        if(err) return res.send("Erreur mise à jour")

        // Log the update
        db.query("INSERT INTO logs (action) VALUES (?)", [`Mise à jour utilisateur ID ${userId}: grade_title=${grade_title}, accreditation=${computedAccreditation}`], (logErr)=>{
            if(logErr) console.error("Erreur log:", logErr)
        })

        res.redirect("/users/admin")
    })
})

module.exports = router