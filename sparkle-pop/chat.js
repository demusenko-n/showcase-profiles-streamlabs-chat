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

/* Sparkles: when a message appears, a few small stars and dots burst
   out of the ✦ next to the nick, then everything settles.
   Works via MutationObserver, so it doesn't depend on the event format. */

const SPARK_COLORS = ['#9eb5eb', '#89a0d8', '#b2c0ed', '#5d7cbc'];

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function burst(row) {
    const log = document.getElementById('log');
    const star = row.querySelector('.star');

    if (!star || log.classList.contains('sparkle-off')) {
        return;
    }

    const sparks = document.createElement('span');
    sparks.className = 'sparks';

    /* fan up and to the right: to the left the ✦ hits the source edge,
       downward it hits the text bubble */
    const count = 7;
    const from = -150;
    const to = 10;

    for (let i = 0; i < count; i++) {
        const spark = document.createElement('i');
        const angle = from + ((to - from) / (count - 1)) * i + rand(-10, 10);

        spark.className = i % 2 ? 'dot' : 'twinkle';
        spark.textContent = i % 2 ? '' : '✦';
        spark.style.setProperty('--a', `${angle}deg`);
        spark.style.setProperty('--d', `${rand(1.3, 2.3).toFixed(2)}em`);
        spark.style.setProperty('--s', rand(0.55, 0.95).toFixed(2));
        spark.style.setProperty('--t', `${rand(0.8, 1.1).toFixed(2)}s`);
        spark.style.setProperty('--w', `${rand(0, 0.12).toFixed(2)}s`);
        spark.style.setProperty('--c', SPARK_COLORS[i % SPARK_COLORS.length]);

        sparks.append(spark);
    }

    star.after(sparks);   /* next to the ✦, not inside: its own animation doesn't spin the sparkles */

    /* remove particles once they finish so they don't pile up */
    setTimeout(() => sparks.remove(), 1400);
}

new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.parentElement?.id === 'log') {
                burst(node);
            }
        }
    }
}).observe(document.getElementById('log'), { childList: true });
