const photoViewer = document.querySelector('#photo-viewer')

if(photoViewer){
    const photoButtons = Array.from(document.querySelectorAll('.citizen-photo-button'))
    const viewerImage = document.querySelector('#photo-viewer-image')
    const viewerCounter = document.querySelector('#photo-viewer-counter')
    const zoomOutput = document.querySelector('#photo-viewer-zoom')
    let activePhotoIndex = 0
    let zoom = 1
    let opener = null

    function updatePhoto(){
        const button = photoButtons[activePhotoIndex]
        const thumbnail = button.querySelector('img')
        viewerImage.src = thumbnail.src
        viewerImage.alt = thumbnail.alt
        viewerCounter.textContent = `Photo ${activePhotoIndex + 1} / ${photoButtons.length}`
        zoom = 1
        updateZoom()
    }

    function updateZoom(){
        viewerImage.style.transform = `scale(${zoom})`
        zoomOutput.value = `${Math.round(zoom * 100)} %`
    }

    function showPhoto(index){
        activePhotoIndex = (index + photoButtons.length) % photoButtons.length
        updatePhoto()
    }

    photoButtons.forEach((button, index)=>{
        button.addEventListener('click', ()=>{
            opener = button
            showPhoto(index)
            photoViewer.showModal()
        })
    })

    document.querySelector('[data-photo-close]').addEventListener('click', ()=>photoViewer.close())
    document.querySelector('[data-photo-previous]').addEventListener('click', ()=>showPhoto(activePhotoIndex - 1))
    document.querySelector('[data-photo-next]').addEventListener('click', ()=>showPhoto(activePhotoIndex + 1))
    document.querySelector('[data-zoom-in]').addEventListener('click', ()=>{
        zoom = Math.min(zoom + 0.25, 3)
        updateZoom()
    })
    document.querySelector('[data-zoom-out]').addEventListener('click', ()=>{
        zoom = Math.max(zoom - 0.25, 1)
        updateZoom()
    })
    document.querySelector('[data-zoom-reset]').addEventListener('click', ()=>{
        zoom = 1
        updateZoom()
    })

    photoViewer.addEventListener('click', event=>{
        if(event.target === photoViewer) photoViewer.close()
    })
    photoViewer.addEventListener('close', ()=>{
        if(opener) opener.focus()
    })
    photoViewer.addEventListener('keydown', event=>{
        if(event.key === 'Escape'){
            event.preventDefault()
            photoViewer.close()
            return
        }
        if(event.key === 'ArrowLeft') showPhoto(activePhotoIndex - 1)
        if(event.key === 'ArrowRight') showPhoto(activePhotoIndex + 1)
    })
    photoViewer.querySelector('.photo-viewer-stage').addEventListener('wheel', event=>{
        event.preventDefault()
        zoom = Math.max(1, Math.min(3, zoom + (event.deltaY < 0 ? 0.25 : -0.25)))
        updateZoom()
    }, {passive: false})
}
