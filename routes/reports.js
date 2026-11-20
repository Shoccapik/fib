const express = require("express")
const router = express.Router()
const path = require("path")
const db = require("../config/database")
const auth = require("../middleware/auth")
const logToWebhook = require("../utils/logger")
const splitReportContent = require("../utils/reportLinks")
const {REPORT_LEVEL_LABELS, reportAccessCondition, reportAccessParams, reportLevelLabel, isValidReportLevel} = require("../utils/reportAccess")
const {REPORT_TYPE_OPTIONS, isValidOperationalReportType, reportTypeLabel} = require("../utils/reportTypes")

function reportSelect(){
    return "SELECT r.*, u.username AS agent_username, u.grade_title AS agent_grade FROM reports r LEFT JOIN users u ON r.agent_id = u.id"
}

function accessibleGroupQuery(column){
    return `SELECT g.id FROM groups g
            WHERE g.${column} = ? AND (
                g.created_by = ? OR EXISTS (
                    SELECT 1 FROM reports r
                    WHERE (r.group_id = g.id OR r.group_name = g.name)
                    AND ${reportAccessCondition()}
                )
            )`
}

function accessibleGroupParams(value, user){
    return [value, user.id, ...reportAccessParams(user)]
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
    db.query("SELECT * FROM groups WHERE name = ?", [groupName], (groupErr, groups)=>{
        if(groupErr) return res.status(500).send("Erreur lors de la lecture du dossier groupe")
        db.query(`SELECT * FROM reports WHERE group_name = ? AND ${reportAccessCondition()} ORDER BY created_at DESC`, [groupName, ...reportAccessParams(req.session.user)], (err, reports)=>{
            if(err) return res.status(500).send("Erreur lors de la lecture des rapports du groupe")
            const group = groups[0] || {name: groupName, claims: null, operating_places: null, hideout: null}
            if(Number(group.created_by) !== Number(req.session.user.id) && !reports.length) return res.status(404).send("Dossier groupe introuvable")
            db.query("SELECT * FROM citizens WHERE affiliation = ? ORDER BY nom, prenom", [groupName], (citizenErr, citizens)=>{
                if(citizenErr) return res.status(500).send("Erreur lors de la lecture des citoyens du groupe")
                res.render("group_details", {group, groupName, reports: reports || [], citizens: citizens || [], reportTypeLabel, user: req.session.user})
            })
        })
    })
})

router.get("/",auth,(req,res)=>{

    db.query(`${reportSelect()} WHERE ${reportAccessCondition()} ORDER BY r.created_at DESC`, reportAccessParams(req.session.user), (err,result)=>{
        if(err){
            console.error("Erreur SELECT reports:", err)
            return res.send("Erreur lors de la lecture des rapports")
        }
        db.query(
            `SELECT g.id, g.name FROM groups g
             WHERE g.created_by = ? OR EXISTS (
                 SELECT 1 FROM reports r
                 WHERE (r.group_id = g.id OR r.group_name = g.name)
                 AND ${reportAccessCondition()}
             )
             ORDER BY g.name`,
            [req.session.user.id, ...reportAccessParams(req.session.user)],
            (groupErr, groups)=>{
            if(groupErr) return res.status(500).send("Erreur lors de la lecture des groupes")
            const reports = result.map(report=>({
                ...report,
                level_label: reportLevelLabel(report.level),
                previewSegments: reportPreviewSegments(report.content)
            }))
            res.render("reports",{reports, groups: groups || [], user: req.session.user, reportLevels: REPORT_LEVEL_LABELS, reportTypeLabel})
        })
    })

})

router.get("/:id/pdf", auth, (req,res)=>{
    db.query(`${reportSelect()} WHERE r.id = ? AND ${reportAccessCondition()}`, [req.params.id, ...reportAccessParams(req.session.user)], (err, rows)=>{
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
            if(pdfLoadErr.code === "MODULE_NOT_FOUND"){
                return res.status(503).send("Le générateur PDF ou l’une de ses dépendances manque sur le serveur. Exécutez npm install à la racine du projet, puis redémarrez l’application.")
            }
            return res.status(500).send("La génération PDF est temporairement indisponible")
        }

        const doc = new PDFDocument({
            size: "A4",
            margins: {top: 68, right: 50, bottom: 58, left: 50},
            bufferPages: true,
            info: {
                Title: `Rapport #${report.id} - ${report.title || "Sans titre"}`,
                Author: report.agent_username || "FIB",
                Subject: "Rapport opérationnel FIB"
            }
        })
        const filename = `${report.id}-${safeFilename(report.title)}`
        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `inline; filename="rapport-${filename}.pdf"`)
        res.setHeader("X-Content-Type-Options", "nosniff")
        doc.on("error", pdfErr=>{
            console.error("Erreur lors de la génération du PDF:", pdfErr)
            if(!res.headersSent) res.status(500).end("Erreur lors de la génération du PDF")
            else res.destroy(pdfErr)
        })
        doc.pipe(res)

        const colors = {
            navy: "#0f172a",
            blue: "#2563eb",
            paleBlue: "#dbeafe",
            text: "#1e293b",
            muted: "#64748b",
            border: "#e2e8f0",
            panel: "#f8fafc"
        }
        const pageWidth = doc.page.width
        const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right

        function ensureSpace(height = 34){
            if(doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage()
        }

        const level = reportLevelLabel(report.level)
        const reportType = reportTypeLabel(report.report_type)
        const createdAt = report.created_at ? new Date(report.created_at) : null
        const createdAtText = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString("fr-FR") : "Non renseignée"
        const classificationColor = Number(report.level) === 1 ? "#15803d" : Number(report.level) === 2 ? "#b45309" : Number(report.level) === 3 ? "#c2410c" : Number(report.level) === 4 ? "#b91c1c" : colors.muted
        const metadata = [
            {label: "Référence", value: `#${report.id}`, valueColor: colors.blue},
            {label: "Type de rapport", value: reportType},
            {label: "Agent responsable", value: `${report.agent_username || "Non renseigné"}${report.agent_grade ? ` (${report.agent_grade})` : ""}`},
            {label: "Date de création", value: createdAtText},
            {label: "Confidentialité", value: level, valueColor: classificationColor, accentColor: classificationColor},
            {label: "Groupe associé", value: report.group_name ? `${report.group_name}${report.group_id ? ` (#${report.group_id})` : ""}` : report.group_id ? `Groupe #${report.group_id}` : "Non renseigné"}
        ]

        function sectionHeading(label){
            ensureSpace(54)
            doc.moveDown(0.45)
            const headingY = doc.y
            doc.roundedRect(doc.page.margins.left, headingY + 1, 4, 17, 2).fill(colors.blue)
            doc.fillColor(colors.navy)
                .font("Helvetica-Bold")
                .fontSize(12)
                .text(label.toUpperCase(), doc.page.margins.left + 13, headingY, {characterSpacing: 0.6})
            doc.y = headingY + 27
            doc.x = doc.page.margins.left
        }

        function writeLinkedContent(content){
            const lines = String(content || "").split(/\r?\n/)
            for(const line of lines){
                if(!line){
                    doc.moveDown(0.5)
                    continue
                }
                const segments = splitReportContent(line)
                segments.forEach((segment, index)=>{
                    const options = {continued: index < segments.length - 1, lineGap: 3}
                    if(segment.url){
                        options.link = segment.url
                        options.underline = true
                    }
                    doc.fillColor(segment.url ? colors.blue : colors.text)
                        .font("Helvetica")
                        .fontSize(10.5)
                        .text(segment.text, options)
                })
                doc.moveDown(0.32)
            }
        }

        function writeField(label, value){
            ensureSpace(36)
            doc.fillColor(colors.muted)
                .font("Helvetica-Bold")
                .fontSize(9)
                .text(`${label} : `, {continued: true})
            doc.fillColor(colors.text)
                .font("Helvetica")
                .fontSize(10)
                .text(String(value || "Non renseigné"), {lineGap: 3})
            doc.moveDown(0.35)
        }

        function drawCardRows(fields, columns = 2){
            const gap = 10
            const cardWidth = (contentWidth - gap * (columns - 1)) / columns

            for(let index = 0; index < fields.length; index += columns){
                const row = fields.slice(index, index + columns)
                doc.font("Helvetica").fontSize(10)
                const cards = row.map(field=>{
                    const value = String(field.value || "Non renseigné")
                    const valueHeight = doc.heightOfString(value, {width: cardWidth - 34, lineGap: 2})
                    return {field, value, height: Math.max(52, valueHeight + 34)}
                })
                const rowHeight = Math.max(...cards.map(card=>card.height))
                const maxHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 16

                if(rowHeight > maxHeight){
                    cards.forEach(({field, value})=>writeField(field.label, value))
                    continue
                }

                ensureSpace(rowHeight + gap)
                const rowY = doc.y
                cards.forEach(({field, value, height}, cardIndex)=>{
                    const x = doc.page.margins.left + cardIndex * (cardWidth + gap)
                    doc.roundedRect(x, rowY, cardWidth, height, 7)
                        .fillAndStroke(colors.panel, colors.border)
                    doc.roundedRect(x + 10, rowY + 10, 3, height - 20, 1.5)
                        .fill(field.accentColor || colors.blue)
                    doc.fillColor(colors.muted)
                        .font("Helvetica-Bold")
                        .fontSize(8)
                        .text(field.label.toUpperCase(), x + 20, rowY + 9, {width: cardWidth - 32})
                    doc.fillColor(field.valueColor || colors.text)
                        .font(field.valueColor ? "Helvetica-Bold" : "Helvetica")
                        .fontSize(10)
                        .text(value, x + 20, rowY + 24, {width: cardWidth - 32, lineGap: 2})
                })
                doc.y = rowY + rowHeight + gap
                doc.x = doc.page.margins.left
            }
        }

        const title = report.title || "Rapport sans titre"
        doc.font("Helvetica-Bold").fontSize(22)
        const titleHeight = doc.heightOfString(title, {width: contentWidth, lineGap: 2})
        const headerHeight = Math.max(158, 72 + titleHeight + 42)
        const subtitleY = 72 + titleHeight + 11

        doc.rect(0, 0, pageWidth, headerHeight).fill(colors.navy)
        doc.rect(0, 0, 8, headerHeight).fill(colors.blue)
        doc.image(path.join(__dirname, "..", "public", "images", "FIB.png"), doc.page.margins.left, 25, {fit: [32, 32]})
        doc.fillColor(colors.paleBlue).font("Helvetica-Bold").fontSize(8)
            .text("BUREAU FÉDÉRAL D’INVESTIGATION  /  MDT", doc.page.margins.left + 44, 37, {characterSpacing: 0.8})
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22)
            .text(title, doc.page.margins.left, 72, {width: contentWidth, lineGap: 2})
        doc.fillColor("#bfdbfe").font("Helvetica").fontSize(9)
            .text(`${reportType.toUpperCase()}   •   RÉFÉRENCE #${report.id}`, doc.page.margins.left, subtitleY, {characterSpacing: 0.4})
        doc.y = headerHeight + 20
        doc.x = doc.page.margins.left

        drawCardRows(metadata)

        sectionHeading("Contenu")
        if(report.content){
            writeLinkedContent(report.content)
        } else {
            doc.fillColor(colors.muted).font("Helvetica-Oblique").fontSize(10).text("Aucun contenu renseigné.")
        }

        const groupDetails = [
            {label: "Revendications", value: report.claims},
            {label: "Zones d’opération", value: report.operating_places},
            {label: "Planque connue", value: report.hideout}
        ]
        if(report.report_type === "Dossier" || report.group_name || report.group_id || groupDetails.some(({value})=>value)){
            sectionHeading("Renseignements sur le groupe")
            drawCardRows(groupDetails)
        }

        sectionHeading("Détails opérationnels")
        const operationalDetails = [
            {label: "Personnes concernées", value: report.personnes_concernees},
            {label: "Agents concernés", value: report.agents_concernes},
            {label: "Véhicules", value: report.vehicules},
            {label: "Plaques", value: report.plaques},
            {label: "Armes", value: report.armes},
            {label: "Numéros de série", value: report.numeros_serie}
        ]
        drawCardRows(operationalDetails)

        const pageRange = doc.bufferedPageRange()
        for(let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex++){
            doc.switchToPage(pageIndex)
            const savedX = doc.x
            const savedY = doc.y

            if(pageIndex > pageRange.start){
                doc.fillColor(colors.muted).font("Helvetica-Bold").fontSize(8)
                    .text(`FIB / MDT   •   RAPPORT #${report.id}`, doc.page.margins.left, 28, {characterSpacing: 0.5, lineBreak: false})
                doc.moveTo(doc.page.margins.left, 48)
                    .lineTo(doc.page.width - doc.page.margins.right, 48)
                    .strokeColor(colors.border)
                    .lineWidth(0.7)
                    .stroke()
            }

            const originalBottomMargin = doc.page.margins.bottom
            const footerY = doc.page.height - 30
            doc.page.margins.bottom = 18
            doc.moveTo(doc.page.margins.left, footerY - 8)
                .lineTo(doc.page.width - doc.page.margins.right, footerY - 8)
                .strokeColor(colors.border)
                .lineWidth(0.7)
                .stroke()
            doc.fillColor(colors.muted).font("Helvetica").fontSize(8)
                .text("DOCUMENT INTERNE  •  FIB / MDT", doc.page.margins.left, footerY, {lineBreak: false})
            doc.text(`PAGE ${pageIndex - pageRange.start + 1} / ${pageRange.count}`, doc.page.margins.left, footerY, {
                width: contentWidth,
                align: "right",
                lineBreak: false
            })

            doc.page.margins.bottom = originalBottomMargin
            doc.x = savedX
            doc.y = savedY
        }

        doc.end()
    })
})

router.get("/:id", auth, (req,res)=>{
    const reportId = req.params.id

    db.query(`${reportSelect()} WHERE r.id = ? AND ${reportAccessCondition()}`, [reportId, ...reportAccessParams(req.session.user)], (err,result)=>{
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
            reportLevelLabel,
            reportTypeLabel,
            user: req.session.user
        })
    })
})

router.get("/:id/edit", auth, (req,res)=>{
    const reportId = req.params.id

    db.query(`SELECT * FROM reports r WHERE r.id = ? AND ${reportAccessCondition()}`, [reportId, ...reportAccessParams(req.session.user)], (err,result)=>{
        if(err){
            console.error("Erreur SELECT report pour édition:", err)
            return res.send("Erreur lors de la lecture du rapport")
        }

        if(result.length === 0){
            return res.send("Rapport non trouvé")
        }

        res.render("report_edit", {report: result[0], reportLevels: REPORT_LEVEL_LABELS, reportTypeOptions: REPORT_TYPE_OPTIONS, reportTypeLabel, user: req.session.user})
    })
})

router.post("/:id/update", auth, (req,res)=>{
    const reportId = req.params.id
    const { title, content, level, report_type, group_name, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie } = req.body

    if(!isValidReportLevel(level)) return res.status(400).send("Le niveau du rapport doit être compris entre 1 et 4")

    db.query(`SELECT * FROM reports r WHERE r.id = ? AND ${reportAccessCondition()}`, [reportId, ...reportAccessParams(req.session.user)], (err, oldResults) => {
        if(err){
            console.error("Erreur SELECT report pour modification:", err)
            return res.send("Erreur lors de la lecture du rapport")
        }

        if(oldResults.length === 0){
            return res.send("Rapport non trouvé")
        }

        const oldReport = oldResults[0]
        const reportType = report_type || oldReport.report_type || "Compte-rendu"
        if(oldReport.report_type === "Dossier" ? reportType !== "Dossier" : !isValidOperationalReportType(reportType)){
            return res.status(400).send("Le type de rapport sélectionné est invalide")
        }
        const changes = []

        const diffFields = [
            { key: 'title', label: 'Titre' },
            { key: 'report_type', label: 'Type de rapport' },
            { key: 'content', label: 'Contenu' },
            { key: 'level', label: 'Niveau' },
            { key: 'personnes_concernees', label: 'Personnes concernées' },
            { key: 'agents_concernes', label: 'Agents concernés' },
            { key: 'vehicules', label: 'Véhicules' },
            { key: 'plaques', label: 'Plaques' },
            { key: 'armes', label: 'Armes' },
            { key: 'numeros_serie', label: 'Numéros de série' }
        ]

        const newValues = { title, report_type: reportType, content, level, personnes_concernes, agents_concernes, vehicules, plaques, armes, numeros_serie }

        diffFields.forEach(field => {
            const oldValue = String(oldReport[field.key] ?? '').trim()
            const newValue = String(newValues[field.key] ?? '').trim()
            if(oldValue !== newValue){
                changes.push(`${field.label} : **${oldValue || 'VIDE'}** → **${newValue || 'VIDE'}**`)
            }
        })

        db.query(
            "UPDATE reports SET title = ?, content = ?, level = ?, report_type = ?, group_name = ?, personnes_concernees = ?, agents_concernes = ?, vehicules = ?, plaques = ?, armes = ?, numeros_serie = ? WHERE id = ?",
            [title, content, level, reportType, group_name || null, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie, reportId],
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

    db.query(`DELETE r FROM reports r WHERE r.id = ? AND ${reportAccessCondition()}`, [reportId, ...reportAccessParams(req.session.user)], (err, result)=>{
        if(err){
            console.error("Erreur DELETE report:", err)
            return res.send("Erreur lors de la suppression du rapport")
        }
        if(result.affectedRows === 0) return res.status(404).send("Rapport non trouvé")

        logToWebhook(`🗑️ Rapport supprimé ID : ${reportId}`,'warn')
        res.redirect('/reports')
    })
})

router.post("/create",auth,async(req,res)=>{

    const {title,content,level,report_type,group_id,group_name,claims,operating_places,hideout,personnes_concernees,agents_concernes,vehicules,plaques,armes,numeros_serie} = req.body
    const reportLevel = level === undefined ? 1 : Number(level)
    if(!isValidReportLevel(reportLevel)) return res.status(400).send("Le niveau du rapport doit être compris entre 1 et 4")
    const reportType = report_type || "Compte-rendu"
    if(reportType !== "Dossier" && !isValidOperationalReportType(reportType)){
        return res.status(400).send("Le type de rapport sélectionné est invalide")
    }

    if(report_type === "Dossier"){
        if(!title || !title.trim()) return res.status(400).send("Le nom du dossier est requis")
        const groupName = title.trim()
        db.query(
            `SELECT g.id, (
                g.created_by = ? OR EXISTS (
                    SELECT 1 FROM reports r
                    WHERE (r.group_id = g.id OR r.group_name = g.name)
                    AND ${reportAccessCondition()}
                )
            ) AS can_access FROM groups g WHERE g.name = ?`,
            [req.session.user.id, ...reportAccessParams(req.session.user), groupName],
            (accessErr, existingGroups)=>{
                if(accessErr) return res.status(500).send("Erreur lors de la vérification du dossier")
                if(existingGroups.length && !Number(existingGroups[0].can_access)) return res.status(404).send("Dossier groupe introuvable")

                db.query(
                    "INSERT INTO groups (name, claims, operating_places, hideout, created_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), claims = VALUES(claims), operating_places = VALUES(operating_places), hideout = VALUES(hideout)",
                    [groupName, claims || null, operating_places || null, hideout || null, req.session.user.id],
                    (groupErr, groupResult)=>{
                        if(groupErr) return res.status(500).send("Erreur lors de la création du dossier")
                        db.query(
                            "INSERT INTO reports (title, content, level, report_type, claims, operating_places, hideout, group_id, group_name, agent_id, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [groupName, content || "Dossier de renseignement", reportLevel, "Dossier", claims || null, operating_places || null, hideout || null, groupResult.insertId, groupName, req.session.user.id, personnes_concernees, agents_concernes, vehicules, plaques, armes, numeros_serie],
                            async (reportErr)=>{
                                if(reportErr) return res.status(500).send("Erreur lors de la création du dossier")
                                await logToWebhook(`📁 Nouveau dossier groupe : ${groupName}`,'info',{changes:[`Revendications : ${claims || 'Non renseignées'}`, `Zones : ${operating_places || 'Non renseignées'}`, `Planque : ${hideout || 'Non renseignée'}`]})
                                res.redirect(`/groups/${groupResult.insertId}`)
                            }
                        )
                    }
                )
            }
        )
        return
    }

    const createReport = ()=>{
        db.query(
            "INSERT INTO reports (title,content,level,report_type,group_id,group_name,agent_id,personnes_concernees,agents_concernes,vehicules,plaques,armes,numeros_serie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                title,
                content,
                reportLevel,
                reportType,
                group_id || null,
                group_name || null,
                req.session.user.id,
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
    }

    if(group_id){
        db.query(accessibleGroupQuery("id"), accessibleGroupParams(group_id, req.session.user), (groupErr, accessibleGroups)=>{
            if(groupErr) return res.status(500).send("Erreur lors de la vérification du dossier")
            if(!accessibleGroups.length) return res.status(404).send("Dossier groupe introuvable")
            createReport()
        })
        return
    }
    createReport()

})

module.exports = router