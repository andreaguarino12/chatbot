const CHAT_WEBHOOK_URL = 'https://preventyx.osaspace.net/webhook/e04d26e2-bfe3-48f9-bf8d-e70d481b15a8/chat';
const ATTACHMENT_WEBHOOK_URL = 'https://preventyx.osaspace.net/webhook/cb136faf-b4fa-4d6a-bf45-0c55407d7494d749';
const SESSION_STORAGE_KEY = 'preventyx-chat-session-id';

const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const attachmentInput = document.getElementById('attachmentInput');
const attachmentTray = document.getElementById('attachmentTray');
const attachmentBadge = document.getElementById('attachmentBadge');
const attachmentLabel = document.getElementById('attachmentLabel');
const attachmentName = document.getElementById('attachmentName');
const clearAttachmentBtn = document.getElementById('clearAttachmentBtn');
const recordedAudio = document.getElementById('recordedAudio');
const audioPreviewBox = document.getElementById('audioPreviewBox');
const audioMeta = document.getElementById('audioMeta');
const recorderStatus = document.getElementById('recorderStatus');
const composerStatus = document.getElementById('composerStatus');
const composer = document.querySelector('.composer');

let currentAttachment = null;
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordingStartedAt = 0;
let isSending = false;

const sessionId = getOrCreateSessionId();

if (
    !chatMessages ||
    !messageInput ||
    !sendBtn ||
    !attachBtn ||
    !recordBtn ||
    !stopBtn ||
    !attachmentInput ||
    !attachmentTray ||
    !attachmentBadge ||
    !attachmentLabel ||
    !attachmentName ||
    !clearAttachmentBtn ||
    !recordedAudio ||
    !audioPreviewBox ||
    !audioMeta ||
    !recorderStatus ||
    !composerStatus ||
    !composer
) {
    throw new Error('Interfaccia chat incompleta: impossibile inizializzare i controlli.');
}

function getOrCreateSessionId() {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const generated = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
}

function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 170)}px`;
}

function setComposerStatus(message, state = '') {
    composerStatus.textContent = message;
    composerStatus.className = `composer-status${state ? ` ${state}` : ''}`;
}

function setRecorderStatus(message, state = 'idle') {
    recorderStatus.textContent = message;
    recorderStatus.className = `recorder-status ${state}`;
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addMessage({ role, text, attachment = null }) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'message-role';
    roleEl.textContent = role === 'user' ? 'Tu' : 'Assistente';

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = text;

    messageEl.appendChild(roleEl);
    messageEl.appendChild(bubbleEl);

    if (attachment) {
        const attachmentEl = document.createElement('div');
        attachmentEl.className = 'message-attachment';

        const title = document.createElement('strong');
        title.textContent = attachment.title;
        attachmentEl.appendChild(title);

        const subtitle = document.createElement('span');
        subtitle.textContent = attachment.subtitle;
        attachmentEl.appendChild(subtitle);

        if (attachment.audioUrl) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = attachment.audioUrl;
            attachmentEl.appendChild(audio);
        }

        messageEl.appendChild(attachmentEl);
    }

    chatMessages.appendChild(messageEl);
    scrollToBottom();
}

function updateSendButtonState() {
    const hasText = messageInput.value.trim().length > 0;
    const canSend = hasText || Boolean(currentAttachment);
    sendBtn.disabled = isSending || !canSend;
    sendBtn.setAttribute('aria-disabled', String(sendBtn.disabled));
    sendBtn.querySelector('span').textContent = isSending ? 'Invio...' : 'Invia';
    composer.classList.toggle('is-ready', canSend && !isSending);
}

function updateAttachmentTray() {
    if (!currentAttachment) {
        attachmentTray.classList.add('hidden');
        attachmentBadge.textContent = 'FILE';
        attachmentLabel.textContent = 'Allegato pronto';
        attachmentName.textContent = 'Nessun contenuto selezionato';
        audioPreviewBox.classList.add('hidden');
        updateSendButtonState();
        return;
    }

    attachmentTray.classList.remove('hidden');
    attachmentBadge.textContent = currentAttachment.kind === 'audio' ? 'AUDIO' : 'FILE';
    attachmentLabel.textContent = currentAttachment.kind === 'audio' ? 'Audio registrato' : 'Documento allegato';
    attachmentName.textContent = currentAttachment.file.name;

    if (currentAttachment.kind === 'audio' && currentAttachment.previewUrl) {
        recordedAudio.src = currentAttachment.previewUrl;
        audioMeta.textContent = currentAttachment.meta || '';
        audioPreviewBox.classList.remove('hidden');
    } else {
        recordedAudio.removeAttribute('src');
        recordedAudio.load();
        audioMeta.textContent = '';
        audioPreviewBox.classList.add('hidden');
    }

    updateSendButtonState();
}

function clearAttachment() {
    if (currentAttachment?.previewUrl) {
        URL.revokeObjectURL(currentAttachment.previewUrl);
    }

    currentAttachment = null;
    attachmentInput.value = '';
    recordBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    stopBtn.disabled = false;
    updateAttachmentTray();
    setRecorderStatus('Microfono pronto', 'idle');
}

function setAttachmentFromFile(file) {
    clearAttachment();
    currentAttachment = {
        kind: 'file',
        file
    };
    updateAttachmentTray();
}

function setAttachmentFromAudio(file, previewUrl, meta) {
    clearAttachment();
    currentAttachment = {
        kind: 'audio',
        file,
        previewUrl,
        meta
    };
    updateAttachmentTray();
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = `${totalSeconds % 60}`.padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function pickRecordingMimeType() {
    const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
    ];

    return supportedTypes.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
}

function buildRecordingFile(blob) {
    const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return new File([blob], `audio-${timestamp}.${extension}`, { type: blob.type || 'audio/webm' });
}

function stopTracks() {
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }
}

function extractReply(data) {
    if (!data) return 'Operazione completata.';
    if (typeof data === 'string') return data;
    if (typeof data.reply === 'string') return data.reply;
    if (typeof data.output === 'string') return data.output;
    if (typeof data.message === 'string') return data.message;
    if (Array.isArray(data) && typeof data[0] === 'string') return data[0];

    if (Array.isArray(data)) {
        for (const item of data) {
            if (item && typeof item === 'object') {
                const nested = extractReply(item);
                if (nested && nested !== 'Operazione completata.') return nested;
            }
        }
    }

    if (typeof data === 'object') {
        for (const value of Object.values(data)) {
            if (typeof value === 'string' && value.trim()) return value;
        }
    }

    return 'Operazione completata.';
}

async function sendTextMessage(text) {
    const response = await fetch(CHAT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'sendMessage',
            chatInput: text,
            text,
            message: text,
            sessionId
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const raw = await response.text();
    let data = raw;

    try {
        data = raw ? JSON.parse(raw) : null;
    } catch {
        data = raw;
    }

    return extractReply(data);
}

async function sendAttachment(note) {
    const formData = new FormData();
    formData.append('file', currentAttachment.file);
    formData.append('attachment', currentAttachment.file);
    formData.append('filename', currentAttachment.file.name);
    formData.append('mimeType', currentAttachment.file.type || 'application/octet-stream');
    formData.append('sessionId', sessionId);
    formData.append('source', currentAttachment.kind);

    if (note) {
        formData.append('note', note);
        formData.append('chatInput', note);
        formData.append('text', note);
        formData.append('message', note);
    } else {
        formData.append('chatInput', '');
        formData.append('text', '');
        formData.append('message', '');
    }

    if (currentAttachment.kind === 'audio') {
        formData.append('audio', currentAttachment.file);
    }

    const response = await fetch(ATTACHMENT_WEBHOOK_URL, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const raw = await response.text();
    let data = raw;

    try {
        data = raw ? JSON.parse(raw) : null;
    } catch {
        data = raw;
    }

    return extractReply(data);
}

async function handleSend() {
    const text = messageInput.value.trim();
    if ((!text && !currentAttachment) || isSending) {
        return;
    }

    isSending = true;
    updateSendButtonState();
    setComposerStatus('Invio al workflow n8n in corso...');

    const attachmentForMessage = currentAttachment
        ? {
              title: currentAttachment.file.name,
              subtitle: currentAttachment.kind === 'audio' ? 'Nota vocale allegata' : 'Documento allegato',
              audioUrl:
                  currentAttachment.kind === 'audio'
                      ? URL.createObjectURL(currentAttachment.file)
                      : ''
          }
        : null;

    addMessage({
        role: 'user',
        text: text || (currentAttachment?.kind === 'audio' ? 'Invio audio' : 'Invio documento'),
        attachment: attachmentForMessage
    });

    messageInput.value = '';
    autoResizeTextarea();

    try {
        let reply = '';

        if (currentAttachment) {
            reply = await sendAttachment(text);
        } else {
            reply = await sendTextMessage(text);
        }

        addMessage({
            role: 'assistant',
            text: reply || 'Ricevuto.'
        });

        setComposerStatus('Messaggio inviato correttamente.', 'success');
        clearAttachment();
    } catch (error) {
        console.error('Send error:', error);
        addMessage({
            role: 'assistant',
            text: 'Invio non riuscito. Verifica il webhook n8n, il CORS o la configurazione del workflow.'
        });
        setComposerStatus('Errore di invio verso n8n.', 'error');
    } finally {
        isSending = false;
        updateSendButtonState();
    }
}

attachBtn.addEventListener('click', () => {
    attachmentInput.value = '';
    attachmentInput.click();
    setComposerStatus('Seleziona un file da allegare alla conversazione.');
});

attachmentInput.addEventListener('change', () => {
    const file = attachmentInput.files[0];
    if (!file) return;

    setAttachmentFromFile(file);
    setComposerStatus('Documento pronto per l\'invio al webhook allegati.');
});

clearAttachmentBtn.addEventListener('click', () => {
    clearAttachment();
    setComposerStatus('Allegato rimosso.');
});

recordBtn.addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        setComposerStatus('Registrazione audio non supportata in questo browser.', 'error');
        return;
    }

    if (!window.isSecureContext) {
        setRecorderStatus('Microfono non disponibile', 'idle');
        setComposerStatus('Il microfono funziona solo su HTTPS o localhost.', 'error');
        return;
    }

    try {
        clearAttachment();
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = pickRecordingMimeType();
        mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
        audioChunks = [];
        recordingStartedAt = Date.now();

        mediaRecorder.addEventListener('dataavailable', (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        });

        mediaRecorder.addEventListener(
            'stop',
            () => {
                const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                const file = buildRecordingFile(blob);
                const previewUrl = URL.createObjectURL(blob);
                const meta = `Durata ${formatDuration(Date.now() - recordingStartedAt)}`;

                setAttachmentFromAudio(file, previewUrl, meta);
                stopTracks();
                mediaRecorder = null;
                recordBtn.classList.remove('hidden');
                stopBtn.classList.add('hidden');
                setRecorderStatus('Audio pronto', 'ready');
                setComposerStatus('Registrazione completata. Puoi inviare l\'audio al webhook allegati.', 'success');
            },
            { once: true }
        );

        mediaRecorder.start();
        recordBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        stopBtn.disabled = false;
        setRecorderStatus('Registrazione in corso', 'recording');
        setComposerStatus('Registrazione audio in corso...');
    } catch (error) {
        console.error('Recording error:', error);
        stopTracks();
        mediaRecorder = null;
        recordBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        setRecorderStatus('Microfono non disponibile', 'idle');
        setComposerStatus('Permesso microfono negato o dispositivo non disponibile.', 'error');
    }
});

stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        stopBtn.disabled = true;
    }
});

sendBtn.addEventListener('click', handleSend);

messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateSendButtonState();
});

messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
    }
});

messageInput.addEventListener('focus', () => {
    setComposerStatus('Premi Invio per spedire, Shift + Invio per andare a capo.');
});

window.addEventListener('beforeunload', () => {
    stopTracks();
    if (currentAttachment?.previewUrl) {
        URL.revokeObjectURL(currentAttachment.previewUrl);
    }
});

autoResizeTextarea();
updateSendButtonState();
setComposerStatus('Chat pronta. Puoi scrivere, allegare un file o registrare audio.');
