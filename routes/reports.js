const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")
const logToWebhook = require("../utils/logger")
const splitReportContent = require("../utils/reportLinks")

function reportSelect(){
    return "SELECT r.*, u.username AS agent_username, u.grade_title AS agent_grade FROM reports r LEFT JOIN users u ON r.agent_id = u.id"
}

function safeFilename(value){
    const filename = String(value || "rapport")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
    return filename || "rapport"
}

function reportPreviewSegments(content, maxLength = 190){
    const text = String(content || "")
    let remaining = maxLength
    const preview = []

    for(const segment of splitReportContent(text)){
        if(remaining <= 0) break
        const visibleText = segment.text.slice(0, remaining)
        if(visibleText) preview.push({...segment, text: visibleText})
        remaining -= visibleText.length
    }

    if(text.length > maxLength) preview.push({text: "..."})
    return preview
}

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

    db.query(`${reportSelect()} ORDER BY r.created_at DESC`, (err,result)=>{
        if(err){
            console.error("Erreur SELECT reports:", err)
            return res.send("Erreur lors de la lecture des rapports")
        }
        db.query("SELECT id, name FROM groups ORDER BY name", (groupErr, groups)=>{
            if(groupErr) return res.status(500).send("Erreur lors de la lecture des groupes")
            const reports = result.map(report=>({
                ...report,
                previewSegments: reportPreviewSegments(report.content)
            }))
            res.render("reports",{reports, groups: groups || [], user: req.session.user})
        })
    })

})

router.get("/:id/pdf", auth, (req,res)=>{
    db.query(`${reportSelect()} WHERE r.id = ?`, [req.params.id], (err, rows)=>{
        if(err){
            console.error("Erreur SELECT report pour PDF:", err)
            return res.status(500).send("Erreur lors de la lecture du rapport")
        }
        if(rows.length === 0) return res.status(404).send("Rapport non trouvé")

        const report = rows[0]
        let PDFDocument
        try {
            PDFDocument = require("pdfkit")
        } catch(pdfLoadErr) {
            console.error("Erreur lors du chargement du générateur PDF:", pdfLoadErr)
            return res.status(500).send("La génération PDF est temporairement indisponible")
        }

        const doc = new PDFDocument({
            size: "A4",
            margins: {top: 52, right: 52, bottom: 56, left: 52},
            info: {
                Title: `Rapport #${report.id} - ${report.title || "Sans titre"}`,
                Author: report.agent_username || "FIB",
                Subject: "Rapport opérationnel FIB"
            }
        })
        const filename = `${report.id}-${safeFilename(report.title)}`
        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `inline; filename="rapport-${filename}.pdf"`)
        doc.on("error", pdfErr=>{
            console.error("Erreur lors de la génération du PDF:", pdfErr)
            if(!res.headersSent) res.status(500).end("Erreur lors de la génération du PDF")
            else res.destroy(pdfErr)
        })
        doc.pipe(res)

        function ensureSpace(height = 34){
            if(doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage()
        }

        doc.fillColor("#1f3cff").font("Helvetica-Bold").fontSize(9).text("FIB  /  RAPPORT OPÉRATIONNEL", {characterSpacing: 1.2})
        doc.moveDown(0.6)
        doc.fillColor("#111827").fontSize(22).font("Helvetica-Bold").text(report.title || "Rapport sans titre")
        doc.moveDown(0.5)

        const level = Number(report.level) === 1 ? "Public" : Number(report.level) === 2 ? "Confidentiel" : Number(report.level) === 3 ? "Secret" : "Non renseigné"
        const reportType = report.report_type === "Dossier" ? "Dossier de groupe" : "Compte-rendu opérationnel"
        const createdAt = report.created_at ? new Date(report.created_at) : null
        const createdAtText = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString("fr-FR") : "Non renseignée"
        const metadata = [
            ["Référence", `#${report.id}`],
            ["Type", reportType],
            ["Agent", `${report.agent_username || "Non renseigné"}${report.agent_grade ? ` (${report.agent_grade})` : ""}`],
            ["Créé le", createdAtText],
            ["Niveau de confidentialité", level]
        ]
        if(report.group_name || report.group_id){
            metadata.push(["Groupe associé", report.group_name || `Groupe #${report.group_id}`])
        }
        metadata.forEach(([label, value])=>{
            doc.fillColor("#475569").font("Helvetica-Bold").fontSize(9).text(`${label} : `, {continued: true})
            doc.fillColor("#1f2937").font("Helvetica").text(value, {lineGap: 2})
        })
        doc.moveDown(0.5)
        doc.moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor("#cbd5e1")
            .lineWidth(1)
            .stroke()

        function sectionHeading(label){
            ensureSpace(42)
            doc.moveDown(0.5)
            doc.fillColor("#1f3cff").font("Helvetica-Bold").fontSize(12).text(label)
            doc.moveDown(0.35)
        }

        function writeLinkedContent(content){
            const lines = String(content || "").split(/\r?\n/)
            for(const line of lines){
                if(!line){
                    doc.moveDown(0.45)
                    continue
                }
                const segments = splitReportContent(line)
                segments.forEach((segment, index)=>{
                    const options = {continued: index < segments.length - 1, lineGap: 3}
                    if(segment.url) options.link = segment.url
                    doc.fillColor(segment.url ? "#1d4ed8" : "#1f2937")
                        .font("Helvetica")
                        .fontSize(10)
                        .text(segment.text, options)
                })
                doc.moveDown(0.3)
            }
        }

        function writeField(label, value){
            ensureSpace(30)
            doc.fillColor("#334155")
                .font("Helvetica-Bold")
                .fontSize(10)
                .text(`${label} : `, {continued: true})
            doc.fillColor("#1f2937")
                .font("Helvetica")
                .text(String(value || "Non renseigné"), {lineGap: 3})
            doc.moveDown(0.4)
        }

        sectionHeading("Contenu")
        if(report.content){
            writeLinkedContent(report.content)
        } else {
            doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(10).text("Aucun contenu renseigné.")
        }

        const groupDetails = [
            ["Revendications", report.claims],
            ["Zones d’opération", report.operating_places],
            ["Planque connue", report.hideout]
        ]
        if(report.report_type === "Dossier" || report.group_name || report.group_id || groupDetails.some(([, value])=>value)){
            sectionHeading("Renseignements sur le groupe")
            groupDetails.forEach(([label, value])=>writeField(label, value))
        }

        sectionHeading("Détails opérationnels")
        const operationalDetails = [
            ["Personnes concernées", report.personnes_concernees],
            ["Agents concernés", report.agents_concernes],
            ["Véhicules", report.vehicules],
            ["Plaques", report.plaques],
            ["Armes", report.armes],
            ["Numéros de série", report.numeros_serie]
        ]
        operationalDetails.forEach(([label, value])=>writeField(label, value))

        doc.end()
    })
})

router.get("/:id", auth, (req,res)=>{
    const reportId = req.params.id

    db.query(`${reportSelect()} WHERE r.id = ?`, [reportId], (err,result)=>{
        if(err){
            console.error("Erreur SELECT report:", err)
            return res.send("Erreur lors de la lecture du rapport")
        }

        if(result.length === 0){
            return res.send("Rapport non trouvé")
        }

        const report = result[0]
        res.render("report_details", {
            report,
            contentSegments: splitReportContent(report.content),
            user: req.session.user
        })
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