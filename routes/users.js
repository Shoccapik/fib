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
    const officialGrades = [
        "Director",
        "Deputy Director",
        "Associate Deputy Director",
        "Special Agent In Charge",
        "Assistant Special Agent In Charge",
        "Deputy Special Agent In Charge",
        "Supervisory Special Agent",
        "Special Agent",
        "Probation Agent"
    ]

    const selectedGrade = officialGrades.includes(grade_title) ? grade_title : null
    const selectedAccreditation = Number.parseInt(accreditation, 10)
    const officialAccreditation = [1, 2, 3, 4].includes(selectedAccreditation) ? selectedAccreditation : 4

    db.query("UPDATE users SET grade_title = ?, accreditation = ? WHERE id = ?", [selectedGrade, officialAccreditation, userId], (err)=>{
        if(err) return res.send("Erreur mise à jour")

        // Log the update
        db.query("INSERT INTO logs (action) VALUES (?)", [`Mise à jour utilisateur ID ${userId}: grade_title=${selectedGrade || 'Non défini'}, accreditation=${officialAccreditation}`], (logErr)=>{
            if(logErr) console.error("Erreur log:", logErr)
        })

        res.redirect("/users/admin")
    })
})

module.exports = router