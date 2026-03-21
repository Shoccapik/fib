const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")

function formatSeconds(seconds){
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    const base = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    return d > 0 ? `${d}j ${base}` : base
}

router.get("/",auth,(req,res)=>{
    const userId = req.session.user.id

    db.query("SELECT * FROM service_logs WHERE user_id = ? ORDER BY start_time DESC LIMIT 1", [userId], (err, last)=>{
        if(err) return res.send("Erreur service")

        const activeLog = (last && last.length > 0 && last[0].end_time === null) ? last[0] : null
        const pausedLog = (last && last.length > 0 && last[0].end_time !== null) ? last[0] : null

        const state = activeLog ? "active" : (req.session.serviceMode === 'paused' ? 'paused' : 'inactive')
        const lastSegmentSeconds = pausedLog ? Math.floor((new Date(pausedLog.end_time) - new Date(pausedLog.start_time))/1000) : 0

            db.query("SELECT IFNULL(SUM(TIMESTAMPDIFF(SECOND, start_time, COALESCE(end_time, pause_time, NOW()))),0) AS totalSeconds FROM service_logs WHERE user_id = ?", [userId], (err2, totalRes)=>{
            if(err2) return res.send("Erreur service")

            const totalSecondsUser = (totalRes && totalRes[0]) ? totalRes[0].totalSeconds : 0
            const totalHoursUser = (totalSecondsUser / 3600).toFixed(2)
            const totalDurationUser = formatSeconds(totalSecondsUser)

            db.query("SELECT u.username, IFNULL(SUM(TIMESTAMPDIFF(SECOND, s.start_time, COALESCE(s.end_time, s.pause_time, NOW()))),0) AS totalSeconds FROM service_logs s JOIN users u ON s.user_id = u.id GROUP BY u.id ORDER BY totalSeconds DESC LIMIT 5", (err3, ranking)=>{
                if(err3) ranking = []

                const rankingWithDuration = (ranking || []).map((entry)=>({
                    ...entry,
                    duration: formatSeconds(entry.totalSeconds || 0)
                }))

                res.render("service", {
                    serviceState: state || 'inactive',
                    lastSegmentSeconds: lastSegmentSeconds || 0,
                    totalHoursUser: totalHoursUser || '0.00',
                    totalDurationUser: totalDurationUser || '00:00:00',
                    ranking: rankingWithDuration || []
                })
            })

        })
    })
})

router.get("/state", auth, (req,res)=>{
    const userId = req.session.user.id
    const serviceState = req.session.serviceMode || 'inactive'
    console.log('GET /service/state - userId:', userId, 'serviceState:', serviceState)

    db.query("SELECT * FROM service_logs WHERE user_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1", [userId], (err, active)=>{
        if(err) {
            console.error('DB error in /state:', err)
            return res.status(500).json({error: 'Erreur'})
        }

        const log = (active && active.length > 0) ? active[0] : null
        console.log('Active log:', log)

        if(log && !log.pause_time){
            // Active
            const elapsedSeconds = Math.floor((new Date() - new Date(log.start_time)) / 1000)
            console.log('Returning active state, elapsedSeconds:', elapsedSeconds)
            return res.json({state:'active', elapsedSeconds, since: Date.now() - elapsedSeconds*1000})
        } else if(log && log.pause_time){
            // Paused
            const elapsedSeconds = Math.floor((new Date(log.pause_time) - new Date(log.start_time)) / 1000)
            console.log('Returning paused state, elapsedSeconds:', elapsedSeconds)
            return res.json({state:'paused', elapsedSeconds, since: Date.now() - elapsedSeconds*1000})
        } else {
            // Inactive, get last completed segment
            db.query("SELECT * FROM service_logs WHERE user_id = ? ORDER BY end_time DESC LIMIT 1", [userId], (err2, last)=>{
                if(err2) {
                    console.error('DB error in last query:', err2)
                    return res.status(500).json({error:'Erreur'})
                }
                if(last && last.length > 0 && last[0].end_time){
                    const lastDuration = Math.floor((new Date(last[0].end_time) - new Date(last[0].start_time))/1000)
                    console.log('Returning inactive state, lastDuration:', lastDuration)
                    return res.json({state:'inactive', elapsedSeconds: lastDuration, since: Date.now() - lastDuration*1000})
                }
                console.log('No logs, returning inactive')
                return res.json({state:'inactive', elapsedSeconds:0})
            })
        }
    })
})

router.post("/start",auth,(req,res)=>{
    const userId = req.session.user.id
    console.log('POST /service/start - userId:', userId)

    db.query("SELECT id FROM service_logs WHERE user_id = ? AND end_time IS NULL", [userId], (err, rows)=>{
        if(err) {
            console.error('DB error in start:', err)
            return res.status(500).send("Erreur")
        }

        if(rows && rows.length > 0){
            console.log('Already active, cannot start')
            return res.status(400).send("Déjà en service")
        }

        db.query("INSERT INTO service_logs (user_id,start_time) VALUES (?,NOW())", [userId], (err2)=>{
            if(err2) {
                console.error('DB error inserting start:', err2)
                return res.status(500).send("Erreur")
            }
            req.session.serviceMode = 'active'
            console.log('Service started, session mode set to active')
            res.send("Service commencé")
        })
    })
})

router.post("/pause",auth,(req,res)=>{
    const userId = req.session.user.id
    console.log('POST /service/pause - userId:', userId)
    db.query("UPDATE service_logs SET pause_time = NOW() WHERE user_id=? AND end_time IS NULL AND pause_time IS NULL", [userId], (err, result)=>{
        if(err) {
            console.error('DB error in pause:', err)
            return res.status(500).send("Erreur")
        }
        if(result.affectedRows === 0) {
            console.log('No active service to pause')
            return res.status(400).send("Pas de service actif")
        }
        req.session.serviceMode = 'paused'
        console.log('Service paused, session mode set to paused')
        res.send("Service en pause")
    })
})

router.post("/resume",auth,(req,res)=>{
    const userId = req.session.user.id
    console.log('POST /service/resume - userId:', userId)
    db.query("UPDATE service_logs SET pause_time = NULL WHERE user_id=? AND end_time IS NULL AND pause_time IS NOT NULL", [userId], (err, result)=>{
        if(err) {
            console.error('DB error in resume:', err)
            return res.status(500).send("Erreur")
        }
        if(result.affectedRows === 0) {
            console.log('No paused service to resume')
            return res.status(400).send("Pas de service en pause")
        }
        req.session.serviceMode = 'active'
        console.log('Service resumed, session mode set to active')
        res.send("Service repris")
    })
})

router.post("/end",auth,(req,res)=>{
    const userId = req.session.user.id
    console.log('POST /service/end - userId:', userId)
    db.query("UPDATE service_logs SET end_time = NOW() WHERE user_id=? AND end_time IS NULL", [userId], (err, result)=>{
        if(err) {
            console.error('DB error in end:', err)
            return res.status(500).send("Erreur")
        }
        req.session.serviceMode = 'inactive'
        console.log('Service ended, session mode set to inactive')

        if(result.affectedRows === 0) {
            console.log('No active service to end')
            return res.status(400).send("Aucun service actif à terminer")
        }

        res.send("Service terminé")
    })
})

module.exports = router