const express = require("express")
const router = express.Router()
const db = require("../config/database")
const bcrypt = require("bcrypt")
const {reportAccessCondition, reportAccessParams} = require("../utils/reportAccess")

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

function withTransaction(work, done){
    db.getConnection((connectionErr, connection)=>{
        if(connectionErr) return done(connectionErr)
        connection.beginTransaction(beginErr=>{
            if(beginErr){
                connection.release()
                return done(beginErr)
            }
            work(connection, transactionErr=>{
                if(transactionErr){
                    return connection.rollback(rollbackErr=>{
                        if(rollbackErr) console.error("Erreur lors de l'annulation de la demande d'inscription:", rollbackErr)
                        connection.release()
                        done(transactionErr)
                    })
                }
                connection.commit(commitErr=>{
                    if(commitErr){
                        return connection.rollback(rollbackErr=>{
                            if(rollbackErr) console.error("Erreur lors de l'annulation de la demande d'inscription:", rollbackErr)
                            connection.release()
                            done(commitErr)
                        })
                    }
                    connection.release()
                    done()
                })
            })
        })
    })
}

router.get("/", (req,res)=>{
    res.render("login")
})

router.post("/login", (req,res)=>{

    const {username,password} = req.body

    db.query("SELECT * FROM users WHERE username = ?",[username], async (err,results)=>{
        if(err) return res.send("Erreur de base de données")

        if(results.length == 0){
            return db.query("SELECT id FROM pending_users WHERE username = ? LIMIT 1", [username], (pendingErr, pendingRows)=>{
                if(pendingErr) return res.status(500).send("Erreur de base de données")
                if(pendingRows.length){
                    return res.status(403).send("Votre demande de compte est en attente de validation par un administrateur de niveau 1.")
                }
                res.status(401).send("Utilisateur introuvable")
            })
        }

        const user = results[0]

        const valid = await bcrypt.compare(password,user.password)

        if(!valid) return res.send("Mot de passe incorrect")

        req.session.user = user
        req.session.save(saveErr=>{
            if(saveErr){
                console.error("Erreur lors de l'enregistrement de la session:", saveErr)
                return res.status(500).send("Erreur lors de l'ouverture de session")
            }

            db.query("INSERT INTO logs (action) VALUES (?)", [`Connexion de l'utilisateur: ${results[0].username}`], (logErr)=>{
                if(logErr) console.error("Erreur log:", logErr)
            })
            res.redirect("/auth/dashboard")
        })

    })

})

router.get("/register", (req,res)=>{
    const registrationMessages = {
        pending: {type: "success", text: "Votre demande a bien été envoyée. Vous pourrez vous connecter après validation par un membre d’accréditation 1."},
        "invalid-details": {type: "error", text: "Vérifiez votre nom, votre mot de passe et le grade sélectionné."},
        "username-taken": {type: "error", text: "Ce nom d’utilisateur est déjà utilisé ou fait l’objet d’une demande."}
    }
    res.render("register", {notice: registrationMessages[req.query.status] || null})
})

router.post("/register", async (req,res)=>{
    const username = typeof req.body.username === "string" ? req.body.username.trim() : ""
    const password = typeof req.body.password === "string" ? req.body.password : ""
    const gradeTitle = typeof req.body.grade_title === "string" ? req.body.grade_title : ""
    const accreditation = gradeLevels[gradeTitle]

    if(!username || username.length > 50 || /[\u0000-\u001f]/.test(username) ||
        Buffer.byteLength(password, "utf8") < 6 || Buffer.byteLength(password, "utf8") > 72 ||
        !accreditation){
        return res.redirect("/auth/register?status=invalid-details")
    }

    let hashedPassword
    try {
        hashedPassword = await bcrypt.hash(password, 10)
    } catch(hashErr) {
        console.error("Erreur lors du chiffrement du mot de passe d'inscription:", hashErr)
        return res.status(500).send("Erreur lors de la création de la demande")
    }

    withTransaction((connection, done)=>{
        connection.query("SELECT id FROM users WHERE username = ? LIMIT 1 FOR UPDATE", [username], (userErr, users)=>{
            if(userErr) return done(userErr)
            if(users.length) return done(Object.assign(new Error("username-taken"), {status: 409}))

            connection.query("INSERT INTO pending_users (username, password, grade, accreditation, grade_title) VALUES (?, ?, 'user', ?, ?)",
                [username, hashedPassword, accreditation, gradeTitle],
                (insertErr, result)=>{
                    if(insertErr) return done(insertErr)
                    connection.query(
                        "INSERT INTO logs (action, actor_username, authorization, target_type) VALUES (?, ?, ?, ?)",
                        [`Demande de création de compte: ${username} (${gradeTitle})`, username, "EN ATTENTE", `Inscription #${result.insertId}`],
                        done
                    )
                }
            )
        })
    }, err=>{
        if(err){
            if(err.message === "username-taken" || err.code === "ER_DUP_ENTRY"){
                return res.redirect("/auth/register?status=username-taken")
            }
            console.error("Erreur lors de la création de la demande de compte:", err)
            return res.status(500).send("Erreur lors de l'inscription")
        }
        res.redirect("/auth/register?status=pending")
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

        db.query(`SELECT COUNT(*) AS totalReports FROM reports r WHERE ${reportAccessCondition()}`, reportAccessParams(req.session.user), (err1, repCount)=>{
            const totalReports = (!err1 && repCount[0]) ? repCount[0].totalReports : 0

            db.query("SELECT COUNT(*) AS totalCitizens FROM citizens", (err2, citCount)=>{
                const totalCitizens = (!err2 && citCount[0]) ? citCount[0].totalCitizens : 0

                db.query(
                    `SELECT u.username, GREATEST(0,
                        IFNULL(SUM(TIMESTAMPDIFF(SECOND, s.start_time, COALESCE(s.end_time, s.pause_time, NOW()))),0)
                        + IFNULL((SELECT SUM(a.adjusted_seconds) FROM service_time_adjustments a WHERE a.user_id = u.id),0)
                    ) AS sec
                    FROM users u
                    LEFT JOIN service_logs s ON s.user_id = u.id
                    GROUP BY u.id
                    HAVING sec > 0
                    ORDER BY sec DESC
                    LIMIT 5`,
                    (err3, serviceRanking)=>{
                        const ranking = err3 ? [] : (serviceRanking || [])

                        db.query(
                            `SELECT GREATEST(0,
                                IFNULL(SUM(TIMESTAMPDIFF(SECOND, start_time, COALESCE(end_time, pause_time, NOW()))),0)
                                + IFNULL((SELECT SUM(adjusted_seconds) FROM service_time_adjustments),0)
                            ) AS totalSeconds
                            FROM service_logs`,
                            (err4, totalSecRes)=>{
                                const totalSeconds = (!err4 && totalSecRes[0]) ? totalSecRes[0].totalSeconds : 0
                                const totalServiceDuration = formatSeconds(totalSeconds)

                                const ranked = (ranking || []).map(user=>({
                                    ...user,
                                    duration: formatSeconds(user.sec || 0),
                                    hours: (user.sec || 0) / 3600
                                }))

                                // Fetch recent reports and citizens for activity
                                db.query(`SELECT r.id, r.title, r.created_at FROM reports r WHERE ${reportAccessCondition()} ORDER BY r.created_at DESC LIMIT 5`, reportAccessParams(req.session.user), (err5, reports)=>{
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