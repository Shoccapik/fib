const express = require("express")
const router = express.Router()
const db = require("../config/database")

const ADMIN_USER_PAGE_SIZE = 30
const gradeOptions = [
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

function isLevelOne(req, res, next){
    if(!req.session.user || Number(req.session.user.accreditation) !== 1){
        return res.status(403).send("Accès réservé à l’accréditation 1")
    }
    next()
}

function isAdmin(req, res, next){
    if(!req.session.user || req.session.user.accreditation > 2){
        return res.status(403).send("Accès refusé")
    }
    next()
}

function formatSeconds(seconds){
    const total = Math.max(0, Math.floor(Number(seconds) || 0))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const remainder = total % 60
    const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    return days ? `${days}j ${time}` : time
}

function accountError(message, status){
    const error = new Error(message)
    error.status = status
    return error
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
                        if(rollbackErr) console.error("Erreur lors de l'annulation de la transaction admin:", rollbackErr)
                        connection.release()
                        done(transactionErr)
                    })
                }

                connection.commit(commitErr=>{
                    if(commitErr){
                        return connection.rollback(rollbackErr=>{
                            if(rollbackErr) console.error("Erreur lors de l'annulation de la transaction admin:", rollbackErr)
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

function writeAccountLog(actor, targetId, action, callback){
    db.query(
        "INSERT INTO logs (action, actor_username, authorization, target_type) VALUES (?, ?, ?, ?)",
        [action, actor.username, "Niveau 1", `Compte #${targetId}`],
        err=>{
            if(err) console.error("Erreur lors de l'enregistrement du journal admin:", err)
            if(callback) callback(err)
        }
    )
}

function getQueryValue(value, maxLength){
    return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function buildAdminUsersPageUrl(page, filters){
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value])=>{
        if(value && value !== "all") params.set(key, value)
    })
    params.set("page", String(page))
    return `/users/admin?${params.toString()}`
}

router.get("/", (req,res)=>{
    res.send("Users page")
})

router.get("/admin", isAdmin, (req,res)=>{
    const filters = {
        q: getQueryValue(req.query.q, 100),
        accreditation: getQueryValue(req.query.accreditation, 10),
        grade: getQueryValue(req.query.grade, 100)
    }
    if(!["all", "1", "2", "3", "4"].includes(filters.accreditation)) filters.accreditation = "all"
    if(filters.grade !== "all" && filters.grade !== "none" && !gradeOptions.includes(filters.grade)){
        filters.grade = "all"
    }

    const conditions = []
    const params = []
    if(filters.q){
        const query = filters.q.toLocaleLowerCase("fr-FR")
        conditions.push(`(
            LOCATE(?, LOWER(COALESCE(username, ''))) > 0
            OR LOCATE(?, LOWER(COALESCE(grade_title, ''))) > 0
            OR LOCATE(?, CAST(id AS CHAR)) > 0
        )`)
        params.push(query, query, query)
    }
    if(filters.accreditation !== "all"){
        conditions.push("accreditation = ?")
        params.push(Number(filters.accreditation))
    }
    if(filters.grade === "none"){
        conditions.push("(grade_title IS NULL OR grade_title = '')")
    }else if(filters.grade !== "all"){
        conditions.push("grade_title = ?")
        params.push(filters.grade)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
    db.query(
        `SELECT
            COUNT(*) AS total,
            COALESCE(SUM(accreditation = 1), 0) AS level1,
            COALESCE(SUM(accreditation = 2), 0) AS level2,
            COALESCE(SUM(accreditation = 3), 0) AS level3,
            COALESCE(SUM(accreditation = 4), 0) AS level4
        FROM users
        ${whereClause}`,
        params,
        (summaryErr, summaryRows)=>{
            if(summaryErr) return res.status(500).send("Erreur lors de la lecture des statistiques utilisateurs")

            const summary = summaryRows[0] || {total: 0, level1: 0, level2: 0, level3: 0, level4: 0}
            const total = Number(summary.total) || 0
            const totalPages = Math.max(1, Math.ceil(total / ADMIN_USER_PAGE_SIZE))
            const requestedPage = Number.parseInt(getQueryValue(req.query.page, 10), 10)
            const currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0
                ? Math.min(requestedPage, totalPages)
                : 1
            const offset = (currentPage - 1) * ADMIN_USER_PAGE_SIZE

            db.query(
                `SELECT id, username, grade_title, accreditation
                FROM users
                ${whereClause}
                ORDER BY username ASC, id ASC
                LIMIT ? OFFSET ?`,
                [...params, ADMIN_USER_PAGE_SIZE, offset],
                (usersErr, results)=>{
                    if(usersErr) return res.status(500).send("Erreur lors de la lecture des utilisateurs")

                    res.render("admin_users", {
                        users: results || [],
                        user: req.session.user,
                        filters,
                        gradeOptions,
                        summary,
                        total,
                        currentPage,
                        totalPages,
                        firstEntry: total ? offset + 1 : 0,
                        lastEntry: Math.min(offset + (results || []).length, total),
                        previousPageUrl: currentPage > 1 ? buildAdminUsersPageUrl(currentPage - 1, filters) : null,
                        nextPageUrl: currentPage < totalPages ? buildAdminUsersPageUrl(currentPage + 1, filters) : null
                    })
                }
            )
        }
    )
})

router.get("/admin-account", isLevelOne, (req,res)=>{
    const notices = {
        "username-updated": {type: "success", text: "Le nom du compte a été mis à jour."},
        "time-updated": {type: "success", text: "Le temps de service a été ajusté."},
        "username-taken": {type: "error", text: "Ce nom de compte est déjà utilisé."},
        "invalid-username": {type: "error", text: "Saisissez un nom de compte de 1 à 50 caractères."},
        "invalid-time": {type: "error", text: "Indiquez une durée valide et un motif."},
        "insufficient-time": {type: "error", text: "La durée à retirer dépasse le temps de service enregistré."},
        "account-not-found": {type: "error", text: "Le compte sélectionné est introuvable."}
    }

    db.query(
        `SELECT u.id, u.username, u.grade_title, u.accreditation,
            GREATEST(0,
                (SELECT IFNULL(SUM(TIMESTAMPDIFF(SECOND, s.start_time, COALESCE(s.end_time, s.pause_time, NOW()))),0)
                 FROM service_logs s WHERE s.user_id = u.id)
                + (SELECT IFNULL(SUM(a.adjusted_seconds),0)
                   FROM service_time_adjustments a WHERE a.user_id = u.id)
            ) AS totalSeconds
         FROM users u
         WHERE u.id <> ?
         ORDER BY u.username`,
        [req.session.user.id],
        (err, users)=>{
            if(err){
                console.error("Erreur lors de la lecture des comptes administrables:", err)
                return res.status(500).send("Erreur lors de la lecture des comptes")
            }

            const accounts = users.map(account=>({
                ...account,
                serviceDuration: formatSeconds(account.totalSeconds)
            }))
            const notice = notices[req.query.notice] || null
            res.render("admin_account", {accounts, notice, user: req.session.user})
        }
    )
})

router.post("/admin-account/:userId/name", isLevelOne, (req,res)=>{
    const targetId = Number(req.params.userId)
    const username = typeof req.body.username === "string" ? req.body.username.trim() : ""
    if(!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === Number(req.session.user.id)){
        return res.status(400).send("Compte cible invalide")
    }
    if(!username || username.length > 50 || /[\u0000-\u001f]/.test(username)){
        return res.redirect("/users/admin-account?notice=invalid-username")
    }

    withTransaction((connection, done)=>{
        connection.query("SELECT id, username FROM users WHERE id = ? FOR UPDATE", [targetId], (targetErr, targetRows)=>{
            if(targetErr) return done(targetErr)
            if(!targetRows.length) return done(accountError("account-not-found", 404))

            const oldUsername = targetRows[0].username
            connection.query("SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1 FOR UPDATE", [username, targetId], (duplicateErr, duplicateRows)=>{
                if(duplicateErr) return done(duplicateErr)
                if(duplicateRows.length) return done(accountError("username-taken", 409))

                connection.query("UPDATE users SET username = ? WHERE id = ?", [username, targetId], updateErr=>{
                    if(updateErr) return done(updateErr)

                    connection.query("UPDATE messages SET sender = ? WHERE sender = ?", [username, oldUsername], senderErr=>{
                        if(senderErr) return done(senderErr)
                        connection.query("UPDATE messages SET receiver = ? WHERE receiver = ?", [username, oldUsername], done)
                    })
                })
            })
        })
    }, err=>{
        if(err){
            if(err.message === "username-taken") return res.redirect("/users/admin-account?notice=username-taken")
            if(err.message === "account-not-found") return res.redirect("/users/admin-account?notice=account-not-found")
            console.error("Erreur lors du changement de nom de compte:", err)
            return res.status(500).send("Erreur lors de la mise à jour du compte")
        }

        writeAccountLog(
            req.session.user,
            targetId,
            `Nom de compte modifié pour l'utilisateur #${targetId}: ${username}`
        )
        res.redirect("/users/admin-account?notice=username-updated")
    })
})

router.post("/admin-account/:userId/service-time", isLevelOne, (req,res)=>{
    const targetId = Number(req.params.userId)
    const hoursText = typeof req.body.hours === "string" ? req.body.hours : ""
    const minutesText = typeof req.body.minutes === "string" ? req.body.minutes : ""
    const hours = /^\d+$/.test(hoursText) ? Number(hoursText) : NaN
    const minutes = /^\d+$/.test(minutesText) ? Number(minutesText) : NaN
    const direction = req.body.direction
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : ""
    const seconds = hours * 3600 + minutes * 60

    if(!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === Number(req.session.user.id)){
        return res.status(400).send("Compte cible invalide")
    }
    if(!Number.isSafeInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59 ||
        !Number.isSafeInteger(seconds) || seconds <= 0 || !["add", "remove"].includes(direction) ||
        reason.length < 3 || reason.length > 255){
        return res.redirect("/users/admin-account?notice=invalid-time")
    }

    withTransaction((connection, done)=>{
        connection.query("SELECT id, username FROM users WHERE id = ? FOR UPDATE", [targetId], (targetErr, targetRows)=>{
            if(targetErr) return done(targetErr)
            if(!targetRows.length) return done(accountError("account-not-found", 404))

            connection.query(
                `SELECT GREATEST(0,
                    (SELECT IFNULL(SUM(TIMESTAMPDIFF(SECOND, start_time, COALESCE(end_time, pause_time, NOW()))),0)
                     FROM service_logs WHERE user_id = ?)
                    + (SELECT IFNULL(SUM(adjusted_seconds),0)
                       FROM service_time_adjustments WHERE user_id = ?)
                ) AS totalSeconds`,
                [targetId, targetId],
                (totalErr, totalRows)=>{
                    if(totalErr) return done(totalErr)
                    const currentSeconds = Math.max(0, Number(totalRows[0].totalSeconds) || 0)
                    if(direction === "remove" && seconds > currentSeconds){
                        return done(accountError("insufficient-time", 400))
                    }

                    const adjustedSeconds = direction === "add" ? seconds : -seconds
                    connection.query(
                        "INSERT INTO service_time_adjustments (user_id, adjusted_seconds, reason, actor_id) VALUES (?, ?, ?, ?)",
                        [targetId, adjustedSeconds, reason, req.session.user.id],
                        done
                    )
                }
            )
        })
    }, err=>{
        if(err){
            if(["insufficient-time", "account-not-found"].includes(err.message)){
                return res.redirect(`/users/admin-account?notice=${err.message}`)
            }
            console.error("Erreur lors de l'ajustement du temps de service:", err)
            return res.status(500).send("Erreur lors de l'ajustement du temps de service")
        }

        writeAccountLog(
            req.session.user,
            targetId,
            `Temps de service ${direction === "add" ? "ajouté" : "retiré"} pour l'utilisateur #${targetId}: ${hours}h ${minutes}min. Motif: ${reason}`
        )
        res.redirect("/users/admin-account?notice=time-updated")
    })
})

router.post("/admin/update", isLevelOne, (req,res)=>{
    const {userId, grade_title, accreditation} = req.body
    const selectedGrade = gradeOptions.includes(grade_title) ? grade_title : null
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