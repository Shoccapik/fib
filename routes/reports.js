const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")
const logToWebhook = require("../utils/logger")

router.get("/",auth,(req,res)=>{

    db.query("SELECT r.*, u.username AS agent_username, u.grade_title AS agent_grade FROM reports r LEFT JOIN users u ON r.agent_id = u.id ORDER BY r.created_at DESC", (err,result)=>{
        if(err){
            console.error("Erreur SELECT reports:", err)
            return res.send("Erreur lors de la lecture des rapports")
        }
        res.render("reports",{reports:result, user: req.session.user})
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
    const { title, content, level, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie } = req.body

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
            "UPDATE reports SET title = ?, content = ?, level = ?, personnes_concernees = ?, agents_concernes = ?, vehicules = ?, plaques = ?, armes = ?, numeros_serie = ? WHERE id = ?",
            [title, content, level, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie, reportId],
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

    const {title,content,level,personnes_concernees,agents_concernes,vehicules,plaques,armes,numeros_serie} = req.body

    db.query(
        "INSERT INTO reports (title,content,level,agent_id,personnes_concernees,agents_concernes,vehicules,plaques,armes,numeros_serie) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            title,
            content,
            level,
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