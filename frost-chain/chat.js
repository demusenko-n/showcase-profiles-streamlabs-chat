function decodeIrcTag(value = '') {
    const escapes = {
        s: ' ',
        ':': ';',
        '\\': '\\',
        r: '\r',
        n: '\n'
    };

    return value.replace(
        /\\(.)/g,
        (_, char) => escapes[char] ?? char
    );
}

function removeReplyMention(message, tags) {
    const parentNames = [
        tags['reply-parent-display-name'],
        tags['reply-parent-user-login']
    ].filter(Boolean).map(name => name.toLowerCase());

    const walker = document.createTreeWalker(
        message,
        NodeFilter.SHOW_TEXT
    );

    let node;

    while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) {
            continue;
        }

        const match = node.textContent.match(
            /^\s*@([^\s]+)(?:\s+|$)/
        );

        if (match && parentNames.includes(match[1].toLowerCase())) {
            node.textContent = node.textContent.slice(match[0].length);
        }

        break;
    }
}

document.addEventListener('onEventReceived', (event) => {
    const detail = event.detail;

    const tags =
        detail?.tags ??
        detail?.event?.tags ??
        detail?.event?.data?.tags;

    if (!tags?.['reply-parent-msg-id'] || !tags.id) {
        return;
    }

    const parentName = tags['reply-parent-display-name'];
    const parentBody = decodeIrcTag(tags['reply-parent-msg-body']);
    const messageId = tags.id;

    function insertReply(attempt = 0) {
        const row = document.querySelector(
            `#log > div[data-id="${CSS.escape(messageId)}"]`
        );

        const message = row?.querySelector('.message');

        if (!message) {
            if (attempt < 20) {
                setTimeout(() => insertReply(attempt + 1), 50);
            }
            return;
        }

        if (message.querySelector('.reply')) {
            return;
        }

        removeReplyMention(message, tags);

        const reply = document.createElement('span');
        reply.className = 'reply';

        const author = document.createElement('span');
        author.className = 'reply-author';
        author.textContent = parentName || '';

        const body = document.createElement('span');
        body.className = 'reply-body';
        body.textContent = parentBody;

        reply.append(author, body);
        message.prepend(reply);
    }

    insertReply();
});

/* Цепь висит сверху и заканчивается на застёжке последнего сообщения.
   Сами звенья стоят на месте (привязаны к низу #log), сообщения едут
   вверх мимо них; JS только обрезает цепь снизу до нужной высоты. */

(function trackChainEnd() {
    const log = document.getElementById('log');

    if (!log) {
        return;
    }

    let frame = 0;

    function update() {
        frame = 0;

        const rows = [...log.children].filter(
            row => row.tagName === 'DIV' && !row.classList.contains('deleted')
        );
        const last = rows[rows.length - 1];

        if (!last) {
            log.style.setProperty('--chain-end', '100%');
            return;
        }

        const hook = getComputedStyle(last, '::before');
        const hookMiddle =
            (parseFloat(hook.top) || 0) + (parseFloat(hook.height) || 0) / 2;
        const end = log.clientHeight - (last.offsetTop + hookMiddle);

        log.style.setProperty('--chain-end', Math.max(0, end) + 'px');
    }

    function schedule() {
        if (!frame) {
            frame = requestAnimationFrame(update);
        }
    }

    new MutationObserver(schedule).observe(log, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    if (window.ResizeObserver) {
        new ResizeObserver(schedule).observe(log);
    }

    schedule();
})();
