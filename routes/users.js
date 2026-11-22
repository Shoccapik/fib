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
const gradeAccreditations = {
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
        "account-deleted": {type: "success", text: "Le compte et ses données associées ont été supprimés."},
        "registration-approved": {type: "success", text: "La demande de compte a été approuvée. Le nouvel agent peut maintenant se connecter."},
        "registration-rejected": {type: "success", text: "La demande de compte a été refusée."},
        "registration-name-taken": {type: "error", text: "Ce nom d’utilisateur est déjà attribué à un compte actif. La demande reste en attente."},
        "username-taken": {type: "error", text: "Ce nom de compte est déjà utilisé."},
        "invalid-username": {type: "error", text: "Saisissez un nom de compte de 1 à 50 caractères."},
        "invalid-time": {type: "error", text: "Indiquez une durée valide et un motif."},
        "insufficient-time": {type: "error", text: "La durée à retirer dépasse le temps de service enregistré."},
        "account-not-found": {type: "error", text: "Le compte sélectionné est introuvable."},
        "last-admin": {type: "error", text: "Le dernier compte d’accréditation 1 ne peut pas être supprimé."},
        "duplicate-username": {type: "error", text: "Un autre compte partage ce nom. Renommez-le avant la suppression pour protéger ses messages."},
        "missing-username": {type: "error", text: "Attribuez d’abord un nom au compte pour supprimer correctement ses données associées."},
        "registration-not-found": {type: "error", text: "Cette demande n’existe plus ou a déjà été traitée."}
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
            db.query(
                "SELECT id, username, grade_title, accreditation, created_at FROM pending_users ORDER BY created_at ASC, id ASC",
                (pendingErr, pendingAccounts)=>{
                    if(pendingErr){
                        console.error("Erreur lors de la lecture des demandes d'inscription:", pendingErr)
                        return res.status(500).send("Erreur lors de la lecture des demandes d'inscription")
                    }
                    const noticeKey = typeof req.query.notice === "string" ? req.query.notice : ""
                    const notice = notices[noticeKey] || null
                    res.render("admin_account", {
                        accounts,
                        pendingAccounts: pendingAccounts || [],
                        notice,
                        user: req.session.user
                    })
                }
            )
        }
    )
})

router.post("/admin-account/registrations/:requestId/approve", isLevelOne, (req,res)=>{
    const requestId = Number(req.params.requestId)
    if(!Number.isSafeInteger(requestId) || requestId <= 0){
        return res.status(400).send("Demande de compte invalide")
    }

    withTransaction((connection, done)=>{
        connection.query(
            "SELECT id, username, password, grade, accreditation, grade_title FROM pending_users WHERE id = ? FOR UPDATE",
            [requestId],
            (requestErr, requests)=>{
                if(requestErr) return done(requestErr)
                if(!requests.length) return done(accountError("registration-not-found", 404))
                const request = requests[0]
                if(!gradeOptions.includes(request.grade_title) ||
                    Number(request.accreditation) !== gradeAccreditations[request.grade_title]){
                    return done(new Error("Invalid pending registration grade"))
                }

                connection.query("SELECT id FROM users WHERE username = ? LIMIT 1 FOR UPDATE", [request.username], (userErr, users)=>{
                    if(userErr) return done(userErr)
                    if(users.length) return done(accountError("registration-name-taken", 409))

                    connection.query(
                        "INSERT INTO users (username, password, grade, accreditation, grade_title) VALUES (?, ?, ?, ?, ?)",
                        [request.username, request.password, request.grade || "user", request.accreditation, request.grade_title],
                        (insertErr)=>{
                            if(insertErr) return done(insertErr)
                            const target = `Inscription #${requestId}`
                            connection.query(
                                "UPDATE logs SET action = CONCAT(action, ' — approuvée'), actor_username = ?, authorization = 'ACCORDEE' WHERE target_type = ? AND authorization = 'EN ATTENTE'",
                                [req.session.user.username, target],
                                (logUpdateErr, logResult)=>{
                                    if(logUpdateErr) return done(logUpdateErr)
                                    const deleteRequest = logResult.affectedRows
                                        ? callback=>connection.query("DELETE FROM pending_users WHERE id = ?", [requestId], callback)
                                        : callback=>connection.query(
                                            "INSERT INTO logs (action, actor_username, authorization, target_type) VALUES (?, ?, ?, ?)",
                                            [`Demande de compte approuvée: ${request.username}`, req.session.user.username, "ACCORDEE", target],
                                            logInsertErr=>{
                                                if(logInsertErr) return callback(logInsertErr)
                                                connection.query("DELETE FROM pending_users WHERE id = ?", [requestId], callback)
                                            }
                                        )
                                    deleteRequest(done)
                                }
                            )
                        }
                    )
                })
            }
        )
    }, err=>{
        if(err){
            if(err.message === "registration-not-found") return res.redirect("/users/admin-account?notice=registration-not-found")
            if(err.message === "registration-name-taken") return res.redirect("/users/admin-account?notice=registration-name-taken")
            console.error("Erreur lors de l'approbation de la demande de compte:", err)
            return res.status(500).send("Erreur lors de l'approbation de la demande")
        }
        res.redirect("/users/admin-account?notice=registration-approved")
    })
})

router.post("/admin-account/registrations/:requestId/reject", isLevelOne, (req,res)=>{
    const requestId = Number(req.params.requestId)
    if(!Number.isSafeInteger(requestId) || requestId <= 0){
        return res.status(400).send("Demande de compte invalide")
    }

    withTransaction((connection, done)=>{
        connection.query(
            "SELECT id, username FROM pending_users WHERE id = ? FOR UPDATE",
            [requestId],
            (requestErr, requests)=>{
                if(requestErr) return done(requestErr)
                if(!requests.length) return done(accountError("registration-not-found", 404))
                const request = requests[0]
                const target = `Inscription #${requestId}`

                connection.query(
                    "UPDATE logs SET action = CONCAT(action, ' — refusée'), actor_username = ?, authorization = 'REFUSEE' WHERE target_type = ? AND authorization = 'EN ATTENTE'",
                    [req.session.user.username, target],
                    (logUpdateErr, logResult)=>{
                        if(logUpdateErr) return done(logUpdateErr)
                        if(logResult.affectedRows){
                            return connection.query("DELETE FROM pending_users WHERE id = ?", [requestId], done)
                        }

                        connection.query(
                            "INSERT INTO logs (action, actor_username, authorization, target_type) VALUES (?, ?, ?, ?)",
                            [`Demande de compte refusée: ${request.username}`, req.session.user.username, "REFUSEE", target],
                            logInsertErr=>{
                                if(logInsertErr) return done(logInsertErr)
                                connection.query("DELETE FROM pending_users WHERE id = ?", [requestId], done)
                            }
                        )
                    }
                )
            }
        )
    }, err=>{
        if(err){
            if(err.message === "registration-not-found") return res.redirect("/users/admin-account?notice=registration-not-found")
            console.error("Erreur lors du refus de la demande de compte:", err)
            return res.status(500).send("Erreur lors du refus de la demande")
        }
        res.redirect("/users/admin-account?notice=registration-rejected")
    })
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

router.post("/admin-account/:userId/delete", isLevelOne, (req,res)=>{
    const targetId = Number(req.params.userId)
    if(!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === Number(req.session.user.id)){
        return res.status(400).send("Compte cible invalide")
    }

    let deletedUsername = ""
    withTransaction((connection, done)=>{
        connection.query(
            "SELECT id, username, accreditation FROM users ORDER BY id FOR UPDATE",
            (usersErr, users)=>{
                if(usersErr) return done(usersErr)
                const target = users.find(account=>Number(account.id) === targetId)
                if(!target) return done(accountError("account-not-found", 404))

                if(typeof target.username !== "string" || !target.username.trim()){
                    return done(accountError("missing-username", 400))
                }

                deletedUsername = target.username
                const normalizedUsername = deletedUsername.toLocaleLowerCase("fr-FR")
                const duplicateUsername = users.filter(account=>
                    typeof account.username === "string" &&
                    account.username.toLocaleLowerCase("fr-FR") === normalizedUsername
                )
                if(duplicateUsername.length > 1){
                    return done(accountError("duplicate-username", 409))
                }

                const remainingLevelOne = users.filter(account=>
                    Number(account.accreditation) === 1 && Number(account.id) !== targetId
                )
                if(Number(target.accreditation) === 1 && remainingLevelOne.length === 0){
                    return done(accountError("last-admin", 409))
                }

                connection.query("SELECT id FROM groups WHERE created_by = ? FOR UPDATE", [targetId], groupsErr=>{
                    if(groupsErr) return done(groupsErr)

                    connection.query(
                        `DELETE FROM app_sessions
                         WHERE CASE
                            WHEN JSON_VALID(data) THEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id'))
                            ELSE NULL
                         END = ?`,
                        [String(targetId)],
                        sessionsErr=>{
                            if(sessionsErr) return done(sessionsErr)

                            connection.query(
                                `DELETE FROM reports
                                 WHERE agent_id = ?
                                    OR group_id IN (SELECT id FROM groups WHERE created_by = ?)
                                    OR group_name IN (SELECT name FROM groups WHERE created_by = ?)`,
                                [targetId, targetId, targetId],
                                reportsErr=>{
                                    if(reportsErr) return done(reportsErr)

                                    connection.query("DELETE FROM groups WHERE created_by = ?", [targetId], groupsDeleteErr=>{
                                        if(groupsDeleteErr) return done(groupsDeleteErr)

                                        connection.query(
                                            "DELETE FROM messages WHERE sender = ? OR receiver = ?",
                                            [deletedUsername, deletedUsername],
                                            messagesErr=>{
                                                if(messagesErr) return done(messagesErr)

                                                connection.query("DELETE FROM service_logs WHERE user_id = ?", [targetId], serviceErr=>{
                                                    if(serviceErr) return done(serviceErr)

                                                    connection.query(
                                                        "DELETE FROM service_time_adjustments WHERE user_id = ? OR actor_id = ?",
                                                        [targetId, targetId],
                                                        adjustmentsErr=>{
                                                            if(adjustmentsErr) return done(adjustmentsErr)

                                                            connection.query(
                                                                `DELETE FROM logs
                                                                 WHERE actor_username = ?
                                                                    OR target_type = ?
                                                                    OR action = CONCAT('Connexion de l''utilisateur: ', ?)
                                                                    OR LOCATE(CONCAT('Nouvel utilisateur inscrit: ', ?, ' ('), action) = 1
                                                                    OR LOCATE(CONCAT('Mise à jour utilisateur ID ', ?, ':'), action) = 1`,
                                                                [
                                                                    deletedUsername,
                                                                    `Compte #${targetId}`,
                                                                    deletedUsername,
                                                                    deletedUsername,
                                                                    targetId
                                                                ],
                                                                logsErr=>{
                                                                    if(logsErr) return done(logsErr)

                                                                    connection.query("DELETE FROM users WHERE id = ?", [targetId], (deleteErr, result)=>{
                                                                        if(deleteErr) return done(deleteErr)
                                                                        if(!result.affectedRows) return done(accountError("account-not-found", 404))
                                                                        done()
                                                                    })
                                                                }
                                                            )
                                                        }
                                                    )
                                                })
                                            }
                                        )
                                    })
                                }
                            )
                        }
                    )
                })
            }
        )
    }, err=>{
        if(err){
            if(["account-not-found", "last-admin", "duplicate-username", "missing-username"].includes(err.message)){
                return res.redirect(`/users/admin-account?notice=${err.message}`)
            }
            console.error("Erreur lors de la suppression du compte et de ses données:", err)
            return res.status(500).send("Erreur lors de la suppression du compte")
        }

        writeAccountLog(
            req.session.user,
            targetId,
            `Compte supprimé avec ses données associées: ${deletedUsername}`,
            logErr=>{
                if(logErr) return res.status(500).send("Compte supprimé, mais la suppression n’a pas pu être inscrite dans les journaux.")
                res.redirect("/users/admin-account?notice=account-deleted")
            }
        )
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