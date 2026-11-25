/*
 * Frost — раскладка, группы и ответы.
 *
 * Новое сообщение обрабатывается в MutationObserver: он срабатывает
 * сразу после вставки строки в #log, до отрисовки кадра. Поэтому замер
 * «влезает ли в строку» и выбор раскладки зритель не видит — сообщение
 * сразу появляется в нужном виде, без прыжков.
 */

/* всё внутри функции: имена вроде log не должны пересекаться
   со скриптами Streamlabs и страницы превью */
(function init() {

    const log = document.getElementById('log');
    if (!log) {
        /* #log ещё не в документе — подождём загрузки */
        document.addEventListener('DOMContentLoaded', init, { once: true });
        return;
    }

    /* Поля Streamlabs приходят классами на #log (вне Streamlabs — оригинал: ник сверху) */
    const layoutMode = () =>
        log.classList.contains('layout-adaptive') ? 'adaptive' :
        log.classList.contains('layout-inline') ? 'inline' : 'stack';
    /* в оригинале (ник сверху) сообщения не объединяются */
    const groupingOn = () => layoutMode() !== 'stack';

    /* Ник длиннее этой доли ширины всегда уходит наверх (догадка, можно подвинуть) */
    const MAX_INLINE_NICK = 0.5;

    /* ---------- ответы ---------- */

    const replyTags = new Map();   // id сообщения → теги ответа

    function decodeIrcTag(value = '') {
        const escapes = { s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' };
        return value.replace(/\\(.)/g, (_, char) => escapes[char] ?? char);
    }

    function removeReplyMention(message, tags) {
        const parentNames = [
            tags['reply-parent-display-name'],
            tags['reply-parent-user-login']
        ].filter(Boolean).map(name => name.toLowerCase());

        const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
        let node;

        while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) {
                continue;
            }
            const match = node.textContent.match(/^\s*@([^\s]+)(?:\s+|$)/);
            if (match && parentNames.includes(match[1].toLowerCase())) {
                node.textContent = node.textContent.slice(match[0].length);
            }
            break;
        }
    }

    /* Вставляет цитату, если для строки уже пришли теги. true — если вставил. */
    function applyReply(row) {
        const tags = replyTags.get(row.dataset.id);
        const message = row.querySelector('.message');

        if (!tags || !message || message.querySelector('.reply')) {
            return false;
        }

        replyTags.delete(row.dataset.id);
        removeReplyMention(message, tags);

        const reply = document.createElement('span');
        reply.className = 'reply';

        const author = document.createElement('span');
        author.className = 'reply-author';
        author.textContent = tags['reply-parent-display-name'] || '';

        const body = document.createElement('span');
        body.className = 'reply-body';
        body.textContent = decodeIrcTag(tags['reply-parent-msg-body']);

        reply.append(author, body);
        message.prepend(reply);

        row.classList.add('is-reply');
        /* ответ с ником сверху; в раскладке «в строку» — цитата, под ней «ник: текст» */
        row.dataset.lay = layoutMode() === 'inline' ? 'inline' : 'stack';
        return true;
    }

    /* ---------- раскладка ---------- */

    function measureLayout(row) {
        if (row.classList.contains('is-reply')) {
            return layoutMode() === 'inline' ? 'inline' : 'stack';
        }
        const mode = layoutMode();
        if (mode !== 'adaptive') {
            return mode;
        }

        row.classList.add('is-inline', 'a-measure');

        const width = row.clientWidth;
        const meta = row.querySelector('.meta');
        const fits =
            row.scrollWidth <= width + 1 &&
            (!meta || meta.getBoundingClientRect().width <= width * MAX_INLINE_NICK);

        row.classList.remove('a-measure');
        return fits ? 'inline' : 'stack';
    }

        /* В строку цитата стоит первой в карточке, над «ник: текст»;
       иначе — внутри .message, как обычно */
    function placeReply(row) {
        const reply = row.querySelector('.reply');
        const message = row.querySelector('.message');
        if (!reply || !message) {
            return;
        }
        if (row.classList.contains('is-inline')) {
            if (reply.parentNode !== row) {
                row.prepend(reply);
            }
        } else if (reply.parentNode !== message) {
            message.prepend(reply);
        }
    }

    /* ---------- группы ---------- */

    const rows = () => [...log.children].filter(el =>
        el.tagName === 'DIV' &&
        !el.classList.contains('deleted') &&
        !el.classList.contains('gone')
    );

    function regroup() {
        const list = rows();
        const group = groupingOn();

        list.forEach((row, i) => {
            const prev = list[i - 1];
            const cont = group && !!prev &&
                prev.dataset.from === row.dataset.from &&
                !row.classList.contains('is-reply') &&
                !prev.classList.contains('is-reply');

            const next = list[i + 1];
            const hasNext = group && !!next &&
                next.dataset.from === row.dataset.from &&
                !row.classList.contains('is-reply') &&
                !next.classList.contains('is-reply');

            row.classList.toggle('g-cont', cont);
            row.classList.toggle('g-next', hasNext);

            /* первое сообщение группы (или одиночное) получает раскладку один раз */
            if (!cont && !row.dataset.lay) {
                row.dataset.lay = measureLayout(row);
            }
            /* в строку только одиночное сообщение: как только у зрителя
           появляется второе подряд, ник уходит наверх, а сообщения
           идут в одной карточке с новой строки */
        row.classList.toggle('is-inline', !cont && !hasNext && row.dataset.lay === 'inline');
        placeReply(row);
        });
    }

    /* ---------- события ---------- */

    /* служебные классы, которые меняет сам скрипт: на них не реагируем */
    const OWN = /\b(g-cont|g-next|is-inline|a-measure|is-reply|gone)\b/g;
    const strip = s => (s || '').replace(OWN, '').trim().replace(/\s+/g, ' ');

    new MutationObserver(records => {
        let changed = false;

        for (const r of records) {
            if (r.type === 'childList') {
                r.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        applyReply(node);
                    }
                });
                changed = true;
            } else if (r.target.parentNode === log &&
                       strip(r.oldValue) !== strip(r.target.className)) {
                changed = true;   // например, Streamlabs пометил сообщение удалённым
            }
        }

        if (changed) {
            regroup();
        }
    }).observe(log, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true
    });

    /* исчезнувшее по таймеру сообщение больше не держит группу:
       следующее за ним становится первым и показывает ник */
    log.addEventListener('animationend', (e) => {
        if (e.animationName === 'frostOut' && e.target.parentNode === log) {
            e.target.classList.add('gone');
            regroup();
        }
    });

    document.addEventListener('onEventReceived', (event) => {
        const detail = event.detail;
        const tags =
            detail?.tags ??
            detail?.event?.tags ??
            detail?.event?.data?.tags;

        if (!tags?.['reply-parent-msg-id'] || !tags.id) {
            return;
        }

        replyTags.set(tags.id, tags);
        if (replyTags.size > 200) {
            replyTags.delete(replyTags.keys().next().value);
        }

        /* строка уже в чате (событие пришло позже вставки) — доделываем сразу;
           иначе цитату вставит MutationObserver */
        const row = log.querySelector(`:scope > div[data-id="${CSS.escape(tags.id)}"]`);
        if (row && applyReply(row)) {
            regroup();
        }
    });

})();
