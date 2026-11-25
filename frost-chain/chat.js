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

/* Цепь: у каждой карточки свой отрезок от её колечка вверх до колечка
   предыдущей (сам отрезок рисует CSS, .chain). Здесь только считаем длину
   отрезка и подгоняем высоту звена так, чтобы звеньев было целое число:
   тогда все колечки сидят на цепи одинаково. */

(function fitChain() {
    const log = document.getElementById('log');

    if (!log) {
        return;
    }

    let frame = 0;

    function update() {
        frame = 0;

        const linkEm = 1.44;
        const em = parseFloat(getComputedStyle(log).fontSize) || 16;
        const period = linkEm * em;

        const rows = [...log.children].filter(
            row => row.tagName === 'DIV' && !row.classList.contains('deleted')
        );

        rows.forEach((row, i) => {
            let seg;
            let link = period;

            if (i === 0) {
                /* верхняя карточка: цепь уходит под заголовок */
                seg = Math.ceil((row.offsetTop + 4 * em) / period) * period;
            } else {
                seg = row.offsetTop - rows[i - 1].offsetTop;
                const count = Math.max(1, Math.round(seg / period));
                link = seg / count;
            }

            row.style.setProperty('--seg', seg + 'px');
            row.style.setProperty('--link', link + 'px');
        });
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
