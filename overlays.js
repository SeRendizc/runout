(function () {
  'use strict';

  const cameraLabels = {
    overview: '山谷全景',
    source: '源区',
    helicopter: '直升机视角',
    confluence: '汇流口',
    dispatch: '预警分发',
    town: '聚落',
    evacuation: '撤离路线',
  };
  const noticeWindow = 2;
  const cardLimit = 3;
  const evidenceWindow = 2.4;

  function timeLabel(minute) {
    if (!Number.isFinite(minute)) return '';
    const seconds = Math.max(0, Math.round(minute * 60));
    return `T+${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function write(element, value) {
    const next = value || '';
    if (element.textContent !== next) element.textContent = next;
  }

  function durationLabel(minutes) {
    if (!Number.isFinite(minutes)) return '';
    const seconds = Math.round(Math.abs(minutes) * 60);
    if (seconds < 60) return `${seconds} 秒`;
    const fraction = seconds % 60;
    return `${Math.floor(seconds / 60)} 分${fraction ? ` ${fraction} 秒` : ''}`;
  }

  function signedDuration(minutes) {
    if (!Number.isFinite(minutes)) return '—';
    const sign = minutes < 0 ? '−' : '+';
    return `${sign}${durationLabel(minutes)}`;
  }

  function projected(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  function bounded(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function intersects(a, b) {
    return a.x < b.x + b.w + 8 && a.x + a.w + 8 > b.x
      && a.y < b.y + b.h + 8 && a.y + a.h + 8 > b.y;
  }

  function calloutPosition(target, width, height, occupied) {
    const w = 178;
    const h = 68;
    const bounds = (x, y) => ({
      x: bounded(x, 12, width - w - 12), y: bounded(y, 12, height - h - 12), w, h,
    });
    return [
      bounds(target.x + 15, target.y - 36), bounds(target.x - w - 15, target.y - 36),
      bounds(target.x - w / 2, target.y - h - 14), bounds(target.x - w / 2, target.y + 16),
      bounds(target.x + 30, target.y + 16), bounds(target.x - w - 30, target.y + 16),
    ].find((candidate) => !occupied.some((existing) => intersects(candidate, existing)));
  }

  function probeLabel(probe) {
    if (['affected', 'at-risk', 'hit', '可能受影响', '预计受影响'].includes(probe.status)) return '预计受影响';
    if (['outside', 'clear', 'not-detected', 'not_detected', 'unaffected', '未检测到', '未检出'].includes(probe.status) || probe.clear === true) {
      return '未检出过流';
    }
    return '资料不足';
  }

  function channelMarkup() {
    const cards = Array.from({ length: cardLimit }, (_, i) => `
      <article class="ro-dispatch-card ro-dispatch-card-${i}" hidden>
        <div class="ro-dispatch-head"><strong></strong><span></span></div><p></p><small></small>
      </article>`).join('');
    const links = Array.from({ length: cardLimit }, (_, i) => `
      <g class="ro-dispatch-link-${i}" hidden><path class="ro-link-halo"/><path class="ro-link-track"/><path class="ro-link-pulse"/><circle r="3.5"/></g>`).join('');
    return `
      <aside class="ro-evidence" aria-label="收到证据" hidden>
        <div class="ro-channel-label">收到证据 <span>INBOUND</span></div>
        <div class="ro-evidence-list" aria-live="polite"></div>
      </aside>
      <div class="ro-dispatch" hidden>
        <svg class="ro-dispatch-map" aria-hidden="true"><circle class="ro-dispatch-origin" r="5" hidden/>${links}</svg>
        <div class="ro-dispatch-cards">${cards}</div>
      </div>
      <aside class="ro-probe" role="status" aria-live="polite" hidden>
        <div class="ro-channel-label">当前位置 <span>演练判读</span></div>
        <strong class="ro-probe-state"></strong><p class="ro-probe-arrival"></p>
        <p class="ro-probe-duration"></p>
        <p class="ro-probe-elevation"></p><p class="ro-probe-walk"></p><p class="ro-probe-note"></p>
      </aside>
      <section class="ro-recap" aria-label="演练对照" hidden>
        <div class="ro-recap-panel">
          <div class="ro-channel-label">COP31 <span>CLIMATE ADAPTATION</span></div>
          <h2>同一灾害，两种预警条件</h2>
          <p class="ro-recap-scope"></p>
          <div class="ro-recap-metrics">
            <div class="ro-recap-gain"><span></span><strong></strong></div>
            <div><span>演练撤离完成点位</span><strong class="ro-recap-completed"></strong></div>
          </div>
          <table class="ro-recap-table">
            <thead><tr><th scope="col">演练点位</th><th scope="col">提前量</th><th scope="col">本场</th><th scope="col">基线</th></tr></thead>
            <tbody class="ro-recap-rows"></tbody>
          </table>
          <p class="ro-recap-foot">以同一波前、路线与行动假设比较，仅表示本场模拟结果。</p>
          <p class="ro-recap-climate">高山变暖正在改变冰雪与冻土，ENSO 会改变部分地区的降雨分布，而 COP31 气候适应强调把预警转化为行动时间。</p>
        </div>
      </section>`;
  }

  function createChannels(container, get) {
    const evidence = get('evidence');
    const evidenceList = get('evidence-list');
    const dispatch = get('dispatch');
    const dispatchMap = get('dispatch-map');
    const origin = get('dispatch-origin');
    const cards = Array.from({ length: cardLimit }, (_, index) => {
      const node = get(`dispatch-card-${index}`);
      const link = get(`dispatch-link-${index}`);
      return {
        node, link, paths: [...link.querySelectorAll('path')], pin: link.querySelector('circle'),
        name: node.querySelector('strong'), phase: node.querySelector('span'),
        arrival: node.querySelector('p'), margin: node.querySelector('small'),
      };
    });
    const probeNode = get('probe');
    const recap = get('recap');
    let evidenceKey = '';
    let summaryKey = '';
    let width = 0;
    let height = 0;

    const readSize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      if (width && height) dispatchMap.setAttribute('viewBox', `0 0 ${width} ${height}`);
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(readSize).observe(container);
    readSize();

    function reset() {
      for (const node of [evidence, dispatch, probeNode, recap]) node.hidden = true;
      evidenceKey = '';
      summaryKey = '';
    }

    function renderEvidence(signals, minute) {
      const recent = (signals || [])
        .filter((signal) => Number.isFinite(signal.minute) && minute >= signal.minute && minute - signal.minute < evidenceWindow)
        .sort((a, b) => b.minute - a.minute).slice(0, 2);
      evidence.hidden = !recent.length;
      const key = JSON.stringify(recent);
      if (key === evidenceKey) return;
      evidenceKey = key;
      evidenceList.replaceChildren(...recent.map((signal) => {
        const item = document.createElement('div');
        item.className = 'ro-evidence-item';
        item.dataset.kind = signal.kind || '';
        const heading = document.createElement('div');
        const source = document.createElement('strong');
        const time = document.createElement('time');
        const message = document.createElement('p');
        source.textContent = signal.source || '现场报告';
        time.textContent = timeLabel(signal.minute);
        message.textContent = signal.message || '';
        heading.append(source, time);
        item.append(heading, message);
        return item;
      }));
    }

    function renderDispatch(model, minute, context) {
      const targets = (model?.targets || []).filter((point) => projected(point) && point.visible !== false);
      if (model?.active && targets.length && !width) readSize();
      dispatch.hidden = !model?.active || !targets.length || !width || !height;
      if (dispatch.hidden) return;
      const compact = width < 620;
      dispatch.dataset.compact = String(compact);
      const visible = targets.slice(0, compact ? 2 : cardLimit);
      const rawFrom = model.from;
      const from = projected(rawFrom) ? { x: bounded(rawFrom.x, 10, width - 10), y: bounded(rawFrom.y, 10, height - 10) } : null;
      origin.toggleAttribute('hidden', !from);
      if (from) {
        origin.setAttribute('cx', from.x);
        origin.setAttribute('cy', from.y);
      }
      const occupied = [];
      if (context.cue) occupied.push({ x: 0, y: 0, w: Math.min(width * 0.54, 470), h: 108 });
      if (context.phone) occupied.push({ x: width - 310, y: height - 170, w: 310, h: 170 });
      if (context.event) occupied.push({ x: 0, y: height - 94, w: 220, h: 94 });
      if (!evidence.hidden) occupied.push({ x: width - 255, y: 0, w: 255, h: 140 });
      for (const [index, card] of cards.entries()) {
        const target = visible[index];
        const position = target && !compact ? calloutPosition(target, width, height, occupied) : null;
        card.node.hidden = !target || (!compact && !position);
        card.link.toggleAttribute('hidden', !target || !from);
        if (!target) continue;

        const passed = target.passed ?? (Number.isFinite(target.arrival) && minute >= target.arrival);
        const delivered = Number.isFinite(target.notify) && minute >= target.notify;
        const remaining = Number.isFinite(target.arrival) ? target.arrival - minute : null;
        if (from) {
          const dx = target.x - from.x;
          const dy = target.y - from.y;
          const lift = bounded(Math.hypot(dx, dy) * 0.21, 14, 58);
          const middleX = (target.x + from.x) / 2;
          const middleY = (target.y + from.y) / 2 - lift;
          const path = `M ${from.x} ${from.y} Q ${middleX} ${middleY} ${target.x} ${target.y}`;
          for (const stroke of card.paths) stroke.setAttribute('d', path);
          card.pin.setAttribute('cx', target.x);
          card.pin.setAttribute('cy', target.y);
          card.link.dataset.phase = passed ? 'passed' : (delivered ? 'delivered' : 'sending');
        }
        if (card.node.hidden) continue;
        if (position) {
          card.node.style.transform = `translate(${position.x}px, ${position.y}px)`;
          occupied.push(position);
        }
        card.node.dataset.tone = passed || target.canEvacuate === false ? 'critical' : 'light';
        write(card.name, target.name || '演练点位');
        write(card.phase, passed ? '已过流' : (delivered ? '已送达' : '发往'));
        write(card.arrival, passed ? `过流 ${timeLabel(target.arrival)}`
          : (Number.isFinite(remaining) ? `距预计到达 ${durationLabel(Math.max(0, remaining))}` : '到达时间待判读'));
        write(card.margin, Number.isFinite(target.margin) ? `撤离余量 ${signedDuration(target.margin)}` : '撤离余量待判读');
      }
    }

    function renderProbe(probe, minute) {
      probeNode.hidden = !probe;
      if (!probe) return;
      const status = probeLabel(probe);
      probeNode.dataset.tone = status === '预计受影响' ? 'critical' : 'neutral';
      write(get('probe-state'), status);
      const remaining = Number.isFinite(probe.arrival) ? probe.arrival - minute : null;
      write(get('probe-arrival'), Number.isFinite(remaining)
        ? (remaining > 0 ? `预计 ${timeLabel(probe.arrival)} 到达 · 剩余 ${durationLabel(remaining)}` : `模型过流 ${timeLabel(probe.arrival)}`) : '');
      const modeledDuration = status === '预计受影响' && Number.isFinite(probe.clear) && Number.isFinite(probe.arrival)
        ? probe.clear - probe.arrival : null;
      write(get('probe-duration'), Number.isFinite(modeledDuration) && modeledDuration > 0
        ? `模型估计影响持续约 ${durationLabel(modeledDuration)}` : '');
      const heights = [
        Number.isFinite(probe.elevation) ? `当前位置海拔 ${Math.round(probe.elevation)} 米` : '',
        Number.isFinite(probe.targetElevation) ? `演练目标点 ${Math.round(probe.targetElevation)} 米` : '',
      ];
      write(get('probe-elevation'), heights.filter(Boolean).join(' · '));
      write(get('probe-walk'), Number.isFinite(probe.walk) ? `按模型估计步行 ${durationLabel(probe.walk)}` : '');
      write(get('probe-note'), probe.reason || (probe.route?.length > 1 || Number.isFinite(probe.targetElevation)
        ? '路线和目标点高度均为演练估算。' : '仅表示当前模型判读。'));
    }

    function renderRecap(summary) {
      recap.hidden = !summary;
      if (!summary) return;
      const key = JSON.stringify(summary);
      if (key === summaryKey) return;
      summaryKey = key;
      const gain = get('recap-gain');
      gain.hidden = !Number.isFinite(summary.gained);
      write(gain.querySelector('span'), summary.gainLabel || '多源预警新增提前量');
      write(gain.querySelector('strong'), signedDuration(summary.gained));
      const agent = Number.isFinite(summary.completed) ? summary.completed : '—';
      const baseline = Number.isFinite(summary.baselineCompleted) ? summary.baselineCompleted : '—';
      write(get('recap-completed'), `本场 ${agent} / 基线 ${baseline}`);
      write(get('recap-scope'), typeof summary.scope === 'string' ? summary.scope : '多源预警与基线情景对比');
      const result = (complete) => typeof complete === 'boolean' ? (complete ? '完成' : '未完成') : '—';
      const rows = (summary.sites || []).slice(0, 3);
      get('recap-table').hidden = !rows.length;
      get('recap-rows').replaceChildren(...rows.map((site) => {
        const row = document.createElement('tr');
        const name = document.createElement('th');
        name.scope = 'row';
        name.textContent = site.name || '演练点位';
        row.append(name);
        const details = [Number.isFinite(site.lead) ? durationLabel(site.lead) : '—', result(site.agentComplete), result(site.baselineComplete)];
        for (const detail of details) {
          const cell = document.createElement('td');
          cell.textContent = detail;
          row.append(cell);
        }
        return row;
      }));
    }

    function render(frame, context) {
      renderRecap(frame.summary);
      if (frame.summary) {
        for (const node of [evidence, dispatch, probeNode]) node.hidden = true;
        container.dataset.dispatch = 'hidden';
        return;
      }
      renderEvidence(frame.signals, frame.minute);
      renderProbe(frame.probe, frame.minute);
      renderDispatch(frame.probe ? null : frame.dispatch, frame.minute, context);
      container.dataset.dispatch = dispatch.hidden ? 'hidden' : (dispatch.dataset.compact === 'true' ? 'compact' : 'visible');
    }

    return { reset, render };
  }

  function siteEvent(site, event, minute) {
    const arrival = event?.arrival ?? site.arrival;
    const notify = event?.notify ?? site.notify;
    return {
      ...event,
      arrival,
      notify,
      notified: event?.notified ?? (Number.isFinite(notify) && minute >= notify),
      passed: event?.passed ?? (Number.isFinite(arrival) && minute >= arrival),
    };
  }

  function statusOf(event, minute, camera) {
    const status = event.status || '';
    const ended = Number.isFinite(event.end) && minute >= event.end;

    if (camera === 'town' && event.passed) {
      return { label: '已过流', time: event.arrival, tone: 'warning' };
    }
    if (camera === 'confluence' && event.passed && !event.evacuated && Number.isFinite(event.notify)) {
      return { label: '已过流 · 撤离未完成', time: event.arrival, tone: 'warning' };
    }
    if (event.evacuated) return { label: '撤离完成', time: event.end, tone: 'safe' };
    if (['blocked', 'overrun', 'failed', 'unsafe', 'stranded', '未完成', '撤离未完成'].includes(status)) {
      const time = ended ? event.end : (event.blockedAt ?? (event.passed ? event.arrival : null));
      return { label: '撤离未完成', time, tone: 'warning' };
    }
    if (camera === 'evacuation' && event.routeChanged) {
      return { label: '改走备选路线', tone: 'warning' };
    }
    if (camera === 'evacuation' && event.notified && event.progress > 0) {
      return { label: '正在撤离', tone: 'neutral' };
    }
    if (event.passed) return { label: '已过流', time: event.arrival, tone: 'warning' };
    if (event.notified) return { label: '已收到预警', time: event.notify, tone: 'neutral' };
    if (event.arrival === null && event.notify === null) return { label: '本场未触发预警', tone: 'neutral' };
    return { label: '等待通知', tone: 'neutral' };
  }

  function create(container) {
    container.classList.add('ro-story');
    container.innerHTML = `
      <div class="ro-clip" hidden>
        <div class="ro-clip-camera"></div>
        <h2 class="ro-clip-title"></h2>
        <p class="ro-clip-subtitle"></p>
      </div>
      <div class="ro-event" role="status" aria-atomic="true" hidden>
        <span class="ro-event-mark" aria-hidden="true"></span>
        <div>
          <div class="ro-event-site"></div>
          <div class="ro-event-state"></div>
        </div>
        <time class="ro-event-time"></time>
      </div>
      <div class="ro-phone-anchor" hidden>
        <div class="ro-phone" role="status" aria-live="polite" aria-atomic="true">
          <div class="ro-phone-slot" aria-hidden="true"></div>
          <div class="ro-phone-caption"><span>模拟手机通知</span><time class="ro-phone-time"></time></div>
          <div class="ro-notification">
            <div class="ro-notification-brand">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.55" aria-hidden="true">
                <path d="M12 3.5 22 20H2L12 3.5Z" stroke-linejoin="round"/><path d="M12 9v5m0 2.75v1" stroke-linecap="round"/>
              </svg>
              <span class="ro-notification-title">泥石流预警</span>
            </div>
            <div class="ro-notification-site"></div>
            <p class="ro-notification-message"></p>
            <p class="ro-notification-arrival"></p>
          </div>
        </div>
      </div>${channelMarkup()}`;

    const get = (name) => container.querySelector(`.ro-${name}`);
    const cue = get('clip');
    const clipCamera = get('clip-camera');
    const clipTitle = get('clip-title');
    const clipSubtitle = get('clip-subtitle');
    const eventNode = get('event');
    const eventSite = get('event-site');
    const eventState = get('event-state');
    const eventTime = get('event-time');
    const phone = get('phone-anchor');
    const phoneTime = get('phone-time');
    const phoneTitle = get('notification-title');
    const phoneSite = get('notification-site');
    const phoneMessage = get('notification-message');
    const phoneArrival = get('notification-arrival');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const channels = createChannels(container, get);
    let sites = [];
    let siteById = new Map();
    let previousCue = '';
    let previousEvent = '';
    let previousPhone = '';

    function reset(world) {
      sites = world?.sites ?? [];
      siteById = new Map(sites.map((site) => [site.id, site]));
      cue.hidden = true;
      eventNode.hidden = true;
      phone.hidden = true;
      channels.reset();
      delete phone.dataset.site;
      container.dataset.phone = 'hidden';
      container.dataset.dispatch = 'hidden';
      container.dataset.cue = 'hidden';
      previousCue = '';
      previousEvent = '';
      previousPhone = '';
    }

    function automaticPhone(frame, active) {
      if (frame.mode !== 'film') return null;
      let latest = null;
      let latestNotify = -Infinity;
      for (const site of sites) {
        const { notify, notified } = siteEvent(site, frame.events?.[site.id], frame.minute);
        if (!notified || !Number.isFinite(notify) || frame.minute < notify || frame.minute - notify >= noticeWindow) continue;
        if (site === active) return active;
        if (notify > latestNotify) {
          latest = site;
          latestNotify = notify;
        }
      }
      return latest;
    }

    function render(frame) {
      const { minute, mode, clip } = frame;
      if (frame.summary) {
        cue.hidden = true;
        container.dataset.cue = 'hidden';
        eventNode.hidden = true;
        phone.hidden = true;
        container.dataset.phone = 'hidden';
        channels.render(frame, {});
        return;
      }
      const active = siteById.get(frame.activeSiteId ?? clip?.siteId);
      cue.hidden = mode !== 'film' || !clip?.title;
      container.dataset.cue = cue.hidden ? 'hidden' : 'visible';
      if (!cue.hidden) {
        write(clipCamera, cameraLabels[clip.camera] || '');
        write(clipTitle, clip.title);
        write(clipSubtitle, clip.subtitle);
        clipSubtitle.hidden = !clip.subtitle;
        const cueKey = `${clip.camera}:${clip.title}`;
        if (cueKey !== previousCue && !reduceMotion?.matches) {
          cue.animate?.([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], 280);
        }
        previousCue = cueKey;
      }

      const selected = Object.hasOwn(frame, 'phoneSiteId')
        ? siteById.get(frame.phoneSiteId)
        : automaticPhone(frame, active);
      const delivery = selected && siteEvent(selected, frame.events?.[selected.id], minute);
      const notice = frame.phoneNotice;
      const notify = notice?.time ?? delivery?.notify;
      const arrival = notice?.hideArrival ? null : (notice?.arrival ?? delivery?.arrival);
      const showPhone = delivery?.notified && Number.isFinite(notify) && minute >= notify;
      phone.hidden = !showPhone;
      container.dataset.phone = showPhone ? 'visible' : 'hidden';
      if (showPhone) {
        const late = Number.isFinite(arrival) && arrival <= notify;
        write(phoneTime, `送达 ${timeLabel(notify)}`);
        write(phoneTitle, notice?.title || '泥石流预警');
        write(phoneSite, selected.name);
        write(phoneMessage, notice?.message || (late ? '危险波前已到达。' : selected.message) || '请沿标示路线前往演练集合点。');
        const forecast = Number.isFinite(notice?.earliest) && Number.isFinite(notice?.latest)
          ? `预计抵达 ${timeLabel(notice.earliest)}–${timeLabel(notice.latest)}`
          : '';
        write(phoneArrival, forecast || (Number.isFinite(arrival) ? `${late ? '过流' : '预计抵达'} ${timeLabel(arrival)}` : ''));
        phoneArrival.hidden = !phoneArrival.textContent;
        phone.dataset.site = selected.id;
        const phoneKey = `${selected.id}:${notify}`;
        if (previousPhone && phoneKey !== previousPhone && !reduceMotion?.matches) {
          phone.animate?.([{ opacity: 0.45 }, { opacity: 1 }], 250);
        }
        previousPhone = phoneKey;
      } else {
        previousPhone = '';
      }

      const event = active && siteEvent(active, frame.events?.[active.id], minute);
      const showEvent = !frame.probe && Boolean(event) && (!showPhone || selected.id !== active.id || event.passed);
      eventNode.hidden = !showEvent;
      if (showEvent) {
        const status = statusOf(event, minute, clip?.camera);
        write(eventSite, active.name);
        write(eventState, status.label);
        write(eventTime, timeLabel(status.time));
        eventTime.hidden = !Number.isFinite(status.time);
        eventNode.dataset.tone = status.tone;
        const eventKey = `${active.id}:${status.label}`;
        if (eventKey !== previousEvent && !reduceMotion?.matches) {
          eventNode.animate?.([{ opacity: 0.35 }, { opacity: 1 }], 250);
        }
        previousEvent = eventKey;
      }
      channels.render(frame, { cue: !cue.hidden, phone: showPhone, event: showEvent });
    }

    return { reset, render };
  }

  window.RunoutOverlays = { create };
})();
