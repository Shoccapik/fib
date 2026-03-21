const express = require("express")
const router = express.Router()
const db = require("../config/database")
const bcrypt = require("bcrypt")

router.get("/", (req,res)=>{
    res.render("login")
})

router.post("/login", (req,res)=>{

    const {username,password} = req.body

    db.query("SELECT * FROM users WHERE username = ?",[username], async (err,results)=>{
        if(err) return res.send("Erreur de base de données")

        if(results.length == 0) return res.send("Utilisateur introuvable")

        const user = results[0]

        const valid = await bcrypt.compare(password,user.password)

        if(!valid) return res.send("Mot de passe incorrect")

        req.session.user = user
        // Log the login
        db.query("INSERT INTO logs (action) VALUES (?)", [`Connexion de l'utilisateur: ${results[0].username}`], (logErr)=>{
            if(logErr) console.error("Erreur log:", logErr)
        })
        res.redirect("/auth/dashboard")

    })

})

router.get("/register", (req,res)=>{
    res.render("register")
})

router.post("/register", async (req,res)=>{
    const {username, password, grade_title} = req.body

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

    const accreditation = gradeLevels[grade_title] || 4 // default to 4 if invalid

    const hashedPassword = await bcrypt.hash(password, 10)

    db.query("INSERT INTO users (username, password, grade, accreditation, grade_title) VALUES (?, ?, 'user', ?, ?)", [username, hashedPassword, accreditation, grade_title], (err)=>{
        if(err) return res.send("Erreur lors de l'inscription")

        // Log the registration
        db.query("INSERT INTO logs (action) VALUES (?)", [`Nouvel utilisateur inscrit: ${username} (${grade_title})`], (logErr)=>{
            if(logErr) console.error("Erreur log:", logErr)
        })

        res.redirect("/")
    })
})

function isAuth(req, res, next){
    if(!req.session.user){
        return res.redirect("/")
    }
    next()
}

function formatSeconds(seconds){
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    const time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    return d > 0 ? `${d}j ${time}` : time
}

router.get("/dashboard", isAuth, (req,res)=>{
    // Fetch early data in parallel-like nested callbacks
    db.query("SELECT COUNT(DISTINCT user_id) AS on_duty FROM service_logs WHERE end_time IS NULL", (err0, activeAgents)=>{
        const onDuty = (!err0 && activeAgents[0]) ? activeAgents[0].on_duty : 0

        db.query("SELECT COUNT(*) AS totalReports FROM reports", (err1, repCount)=>{
            const totalReports = (!err1 && repCount[0]) ? repCount[0].totalReports : 0

            db.query("SELECT COUNT(*) AS totalCitizens FROM citizens", (err2, citCount)=>{
                const totalCitizens = (!err2 && citCount[0]) ? citCount[0].totalCitizens : 0

                db.query("SELECT u.username, SUM(TIMESTAMPDIFF(SECOND, s.start_time, COALESCE(s.end_time, NOW()))) AS sec FROM service_logs s JOIN users u ON s.user_id = u.id GROUP BY u.id ORDER BY sec DESC LIMIT 5", (err3, serviceRanking)=>{
                    const ranking = err3 ? [] : (serviceRanking || [])

                    db.query("SELECT IFNULL(SUM(TIMESTAMPDIFF(SECOND, start_time, COALESCE(end_time, NOW()))),0) AS totalSeconds FROM service_logs", (err4, totalSecRes)=>{
                        const totalSeconds = (!err4 && totalSecRes[0]) ? totalSecRes[0].totalSeconds : 0
                        const totalServiceDuration = formatSeconds(totalSeconds)

                        const ranked = (ranking || []).map(user=>({
                            ...user,
                            duration: formatSeconds(user.sec || 0),
                            hours: (user.sec || 0) / 3600
                        }))

                        // Fetch recent reports and citizens for activity
                        db.query("SELECT id, title, created_at FROM reports ORDER BY created_at DESC LIMIT 5", (err5, reports)=>{
                            if(err5) reports = []
                            db.query("SELECT id, nom, prenom FROM citizens ORDER BY id DESC LIMIT 5", (err6, citizens)=>{
                                if(err6) citizens = []

                                res.render("dashboard", {
                                    user: req.session.user,
                                    recentReports: reports,
                                    recentCitizens: citizens,
                                    onDuty,
                                    totalReports,
                                    totalCitizens,
                                    totalServiceDuration,
                                    serviceRanking: ranked
                                })
                            })
                        })

                    })

                })

            })

        })

    })
})

router.get("/logout", (req,res)=>{
    req.session.destroy((err)=>{
        if(err) return res.send("Erreur")
        res.redirect("/")
    })
})

module.exports = router