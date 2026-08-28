const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")
const logToWebhook = require("../utils/logger")

router.get("/groups/:groupName", auth, (req,res)=>{
    const groupName = req.params.groupName
    db.query("SELECT * FROM reports WHERE group_name = ? ORDER BY created_at DESC", [groupName], (err, reports)=>{
        if(err) return res.status(500).send("Erreur lors de la lecture du dossier groupe")
        db.query("SELECT * FROM citizens WHERE affiliation = ? ORDER BY nom, prenom", [groupName], (citizenErr, citizens)=>{
            if(citizenErr) return res.status(500).send("Erreur lors de la lecture des citoyens du groupe")
            res.render("group_details", {group: {name: groupName, claims: null, operating_places: null, hideout: null}, groupName, reports: reports || [], citizens: citizens || [], user: req.session.user})
        })
    })
})

router.get("/",auth,(req,res)=>{

    db.query("SELECT r.*, u.username AS agent_username, u.grade_title AS agent_grade FROM reports r LEFT JOIN users u ON r.agent_id = u.id ORDER BY r.created_at DESC", (err,result)=>{
        if(err){
            console.error("Erreur SELECT reports:", err)
            return res.send("Erreur lors de la lecture des rapports")
        }
        db.query("SELECT id, name FROM groups ORDER BY name", (groupErr, groups)=>{
            if(groupErr) return res.status(500).send("Erreur lors de la lecture des groupes")
            res.render("reports",{reports:result, groups: groups || [], user: req.session.user})
        })
    })

})

router.get("/:id", auth, (req,res)=>{
    const reportId = req.params.id

    db.query("SELECT r.*, u.username AS agent_username, u.grade_title AS agent_grade FROM reports r LEFT JOIN users u ON r.agent_id = u.id WHERE r.id = ?", [reportId], (err,result)=>{
        if(err){
            console.error("Erreur SELECT report:", err)
            return res.send("Erreur lors de la lecture du rapport")
        }

        if(result.length === 0){
            return res.send("Rapport non trouvé")
        }

        res.render("report_details", {report: result[0], user: req.session.user})
    })
})

router.get("/:id/edit", auth, (req,res)=>{
    const reportId = req.params.id

    db.query("SELECT * FROM reports WHERE id = ?", [reportId], (err,result)=>{
        if(err){
            console.error("Erreur SELECT report pour édition:", err)
            return res.send("Erreur lors de la lecture du rapport")
        }

        if(result.length === 0){
            return res.send("Rapport non trouvé")
        }

        res.render("report_edit", {report: result[0], user: req.session.user})
    })
})

router.post("/:id/update", auth, (req,res)=>{
    const reportId = req.params.id
    const { title, content, level, group_name, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie } = req.body

    db.query("SELECT * FROM reports WHERE id = ?", [reportId], (err, oldResults) => {
        if(err){
            console.error("Erreur SELECT report pour modification:", err)
            return res.send("Erreur lors de la lecture du rapport")
        }

        if(oldResults.length === 0){
            return res.send("Rapport non trouvé")
        }

        const oldReport = oldResults[0]
        const changes = []

        const diffFields = [
            { key: 'title', label: 'Titre' },
            { key: 'content', label: 'Contenu' },
            { key: 'level', label: 'Niveau' },
            { key: 'personnes_concernees', label: 'Personnes concernées' },
            { key: 'agents_concernes', label: 'Agents concernés' },
            { key: 'vehicules', label: 'Véhicules' },
            { key: 'plaques', label: 'Plaques' },
            { key: 'armes', label: 'Armes' },
            { key: 'numeros_serie', label: 'Numéros de série' }
        ]

        const newValues = { title, content, level, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie }

        diffFields.forEach(field => {
            const oldValue = String(oldReport[field.key] ?? '').trim()
            const newValue = String(newValues[field.key] ?? '').trim()
            if(oldValue !== newValue){
                changes.push(`${field.label} : **${oldValue || 'VIDE'}** → **${newValue || 'VIDE'}**`)
            }
        })

        db.query(
            "UPDATE reports SET title = ?, content = ?, level = ?, group_name = ?, personnes_concernees = ?, agents_concernes = ?, vehicules = ?, plaques = ?, armes = ?, numeros_serie = ? WHERE id = ?",
            [title, content, level, group_name || null, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie, reportId],
            (err)=>{
                if(err){
                    console.error("Erreur UPDATE report:", err)
                    return res.send("Erreur lors de la mise à jour du rapport")
                }

                logToWebhook(`✏️ Rapport modifié : ${title}`,'info',{ changes: changes.length ? changes : ['Aucune modification détectée'] })
                res.redirect(`/reports/${reportId}`)
            }
        )
    })
})

router.post("/:id/delete", auth, (req,res)=>{
    const reportId = req.params.id

    db.query("DELETE FROM reports WHERE id = ?", [reportId], (err)=>{
        if(err){
            console.error("Erreur DELETE report:", err)
            return res.send("Erreur lors de la suppression du rapport")
        }

        logToWebhook(`🗑️ Rapport supprimé ID : ${reportId}`,'warn')
        res.redirect('/reports')
    })
})

router.post("/create",auth,async(req,res)=>{

    const {title,content,level,report_type,group_id,group_name,claims,operating_places,hideout,personnes_concernees,agents_concernes,vehicules,plaques,armes,numeros_serie} = req.body

    if(report_type === "Dossier"){
        if(!title || !title.trim()) return res.status(400).send("Le nom du dossier est requis")
        db.query(
            "INSERT INTO groups (name, claims, operating_places, hideout, created_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), claims = VALUES(claims), operating_places = VALUES(operating_places), hideout = VALUES(hideout)",
            [title.trim(), claims || null, operating_places || null, hideout || null, req.session.user.id],
            (groupErr, groupResult)=>{
                if(groupErr) return res.status(500).send("Erreur lors de la création du dossier")
                db.query(
                    "INSERT INTO reports (title, content, level, report_type, claims, operating_places, hideout, group_id, group_name, agent_id, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [title.trim(), content || "Dossier de renseignement", level || 2, "Dossier", claims || null, operating_places || null, hideout || null, groupResult.insertId, title.trim(), req.session.user.id, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie],
                    async (reportErr)=>{
                        if(reportErr) return res.status(500).send("Erreur lors de la création du dossier")
                        await logToWebhook(`📁 Nouveau dossier groupe : ${title.trim()}`,'info',{changes:[`Revendications : ${claims || 'Non renseignées'}`, `Zones : ${operating_places || 'Non renseignées'}`, `Planque : ${hideout || 'Non renseignée'}`]})
                        res.redirect(`/groups/${groupResult.insertId}`)
                    }
                )
            }
        )
        return
    }

    db.query(
        "INSERT INTO reports (title,content,level,report_type,group_id,group_name,agent_id,personnes_concernees,agents_concernes,vehicules,plaques,armes,numeros_serie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            title,
            content,
            level,
            "Compte-rendu",
            group_id || null,
            group_name || null,
            req.session.user ? req.session.user.id : null,
            personnes_concernees,
            agents_concernes,
            vehicules,
            plaques,
            armes,
            numeros_serie
        ],
        async (err)=>{
            if(err){
                console.error("Erreur INSERT reports:", err)
                return res.send("Erreur lors de la création du rapport")
            }

            await logToWebhook(`📄 Nouveau rapport : ${title}`)
            res.redirect("/reports")
        }
    )

})

module.exports = router