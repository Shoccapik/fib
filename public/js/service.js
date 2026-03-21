let startTime = null
let timerInterval = null

const timerDisplay = document.getElementById("timer")
const statusEl = document.getElementById("status")
const startBtn = document.getElementById("startBtn")
const pauseBtn = document.getElementById("pauseBtn")
const resumeBtn = document.getElementById("resumeBtn")
const stopBtn = document.getElementById("stopBtn")

function formatDuration(ms) {
    const sec = Math.floor(ms / 1000)
    const hours = Math.floor(sec / 3600)
    const minutes = Math.floor((sec % 3600) / 60)
    const seconds = sec % 60
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function setStatus(state) {
    statusEl.className = `status-pill status-${state}`
    switch(state){
        case 'active':
            statusEl.textContent = 'Prise de service'
            startBtn.disabled = true
            pauseBtn.disabled = false
            resumeBtn.disabled = true
            stopBtn.disabled = false
            break
        case 'paused':
            statusEl.textContent = 'Pause'
            startBtn.disabled = true
            pauseBtn.disabled = true
            resumeBtn.disabled = false
            stopBtn.disabled = false
            break
        default:
            statusEl.textContent = 'Hors service'
            startBtn.disabled = false
            pauseBtn.disabled = true
            resumeBtn.disabled = true
            stopBtn.disabled = true
            break
    }
}

async function refreshAll(){
    console.log('refreshAll called')
    const res = await fetch('/service/state');
    if(!res.ok) {
        console.error('Failed to fetch /service/state')
        return;
    }
    const data = await res.json();
    console.log('Data from /service/state:', data)
    const state = data.state || 'inactive'

    setStatus(state)

    if(timerInterval) clearInterval(timerInterval)

    if(state === 'active'){
        const base = data.elapsedSeconds * 1000
        timerDisplay.textContent = formatDuration(base)
        let current = base
        timerInterval = setInterval(() => {
            current += 1000
            timerDisplay.textContent = formatDuration(current)
        }, 1000)
    } else if(state === 'paused'){
        const base = data.elapsedSeconds * 1000
        timerDisplay.textContent = formatDuration(base)
    } else {
        timerDisplay.textContent = '00:00:00'
    }
}

async function performAction(path) {
    const res = await fetch(`/service/${path}`, {method:'POST'})
    const text = await res.text()
    if(!res.ok) {
        alert(text || 'Erreur')
        return
    }
    await refreshAll()
}

startBtn.onclick = () => performAction('start')
pauseBtn.onclick = () => performAction('pause')
resumeBtn.onclick = () => performAction('resume')
stopBtn.onclick = () => performAction('end')

window.addEventListener('load', refreshAll)
