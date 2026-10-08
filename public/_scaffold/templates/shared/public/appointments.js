(() => {
  let site = { ...(window.SITE_CONFIG || {}) };
  let csrfToken = '';
  let client = null;
  let monthData = null;
  let selectedDate = '';
  let pendingSlot = null;
  const PAYMENT_PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_PAYMENT_PROOF_BYTES = 3 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  const timeZone = () => site.timeZone || 'Asia/Manila';
  const currentYearMonth = () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone(), year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
  };
  const todayString = () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
  };
  const monthShift = (value, amount) => {
    const [year, month] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const formatMonth = (value) => new Date(`${value}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const formatDate = (value, options = { weekday: 'long', month: 'long', day: 'numeric' }) => new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
  const escapeText = (value) => String(value ?? '');
  function toast(message, isError = false) {
    const node = $('siteToast'); if (!node) return;
    node.textContent = message; node.classList.toggle('error', isError); node.classList.add('visible');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('visible'), 4500);
  }
  async function getCsrf() {
    const response = await fetch('/api/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Security token could not be initialized. Refresh and try again.');
    const data = await response.json(); csrfToken = data.token; return csrfToken;
  }
  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (!['GET', 'HEAD'].includes(method)) {
      if (!csrfToken) await getCsrf();
      headers['X-CSRF-Token'] = csrfToken;
      if (options.body && typeof options.body !== 'string') { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
    }
    const response = await fetch(path, { credentials: 'same-origin', ...options, method, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function setMessage(id, message, error = false) {
    const node = $(id); if (!node) return;
    node.textContent = message; node.classList.toggle('error', error);
  }
  function monthParts(value) { const [year, month] = value.split('-').map(Number); return { year, month }; }
  function dayDateString(year, month, day) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
  function renderMeter(data) {
    const percent = Math.max(0, Math.min(100, Number(data?.fillPercent) || 0));
    $('capacityPercent').textContent = `${percent}%`;
    $('capacityFill').style.width = `${percent}%`;
    $('capacityMeter').setAttribute('aria-valuenow', String(percent));
    $('bookedCount').textContent = String(data?.bookedSlots || 0);
    $('availableCount').textContent = String(data?.availableSlots || 0);
    let detail = 'No monthly schedule has been published yet.';
    if (data?.published && !data.totalSlots) detail = 'The owner has published this month, but no consultation times are open.';
    else if (data?.published && percent >= 100) detail = 'All published consultation times are reserved.';
    else if (data?.published) detail = `${data.totalSlots} published consultation times · ${data.availableSlots} still open.`;
    $('capacityDetail').textContent = detail;
  }
  function renderCalendar(data) {
    monthData = data;
    $('calendarMonthLabel').textContent = formatMonth(data.month);
    $('previousMonth').disabled = data.month <= currentYearMonth();
    $('nextMonth').disabled = data.month >= monthShift(currentYearMonth(), 11);
    renderMeter(data);
    if (!site.features?.scheduling) $('calendarStatus').textContent = 'Online appointments are not enabled. Please contact the practice directly.';
    else if (!data.published) $('calendarStatus').textContent = 'This calendar is empty until the practice publishes its monthly availability.';
    else if (!data.totalSlots) $('calendarStatus').textContent = 'No consultation times have been opened for this month yet.';
    else if (!data.days?.length) $('calendarStatus').textContent = 'No future consultation times remain in this month. Try the next month.';
    else $('calendarStatus').textContent = 'Choose a highlighted date to see the owner’s open consultation times.';
    const grid = $('calendarDays'); grid.replaceChildren();
    const { year, month } = monthParts(data.month);
    const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let i = 0; i < offset; i++) { const blank = document.createElement('span'); blank.className = 'calendar-blank'; blank.setAttribute('aria-hidden', 'true'); grid.appendChild(blank); }
    const dayMap = new Map((data.days || []).map((item) => [item.date, item]));
    for (let day = 1; day <= dayCount; day++) {
      const date = dayDateString(year, month, day); const stats = dayMap.get(date);
      if (stats) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-day';
        if (stats.available > 0) button.classList.add('has-open-times'); else button.classList.add('day-full');
        if (date === selectedDate) button.classList.add('selected');
        button.setAttribute('role', 'gridcell');
        button.setAttribute('aria-label', `${formatDate(date)}, ${stats.available} open and ${stats.booked} reserved`);
        const numeral = document.createElement('strong'); numeral.textContent = String(day);
        const count = document.createElement('small'); count.textContent = stats.available ? `${stats.available} open` : 'Full';
        button.append(numeral, count);
        button.addEventListener('click', () => selectDate(date)); grid.appendChild(button);
      } else {
        const cell = document.createElement('span'); cell.className = 'calendar-day calendar-day-empty'; cell.setAttribute('role', 'gridcell');
        const numeral = document.createElement('strong'); numeral.textContent = String(day); cell.appendChild(numeral); grid.appendChild(cell);
      }
    }
    if (selectedDate && !data.days?.some((item) => item.date === selectedDate)) { selectedDate = ''; renderSlots(); }
    else if (selectedDate) renderSlots();
    $('previousMonth').disabled = data.month <= currentYearMonth();
    $('nextMonth').disabled = data.month >= monthShift(currentYearMonth(), 11);
  }
  function renderSlots() {
    const node = $('calendarSlots'); node.replaceChildren();
    if (!selectedDate) {
      const empty = document.createElement('p'); empty.className = 'slot-empty'; empty.textContent = 'Choose a highlighted date to see open consultation times.'; node.appendChild(empty); return;
    }
    const current = (monthData?.slots || []).filter((slot) => slot.date === selectedDate);
    const day = (monthData?.days || []).find((item) => item.date === selectedDate);
    const heading = document.createElement('div'); heading.className = 'slot-date-heading';
    const title = document.createElement('strong'); title.textContent = formatDate(selectedDate);
    const caption = document.createElement('small'); caption.textContent = day?.available ? `${day.available} times open` : 'No times open';
    heading.append(title, caption); node.appendChild(heading);
    if (!current.length) {
      const empty = document.createElement('p'); empty.className = 'slot-empty'; empty.textContent = day?.booked ? 'All owner-published times on this date are reserved.' : 'No appointment times are published for this date.'; node.appendChild(empty); return;
    }
    const list = document.createElement('div'); list.className = 'slot-button-list';
    current.forEach((slot) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'slot-button'; button.textContent = slot.label;
      button.addEventListener('click', () => chooseSlot(slot)); list.appendChild(button);
    });
    node.appendChild(list);
  }
  function selectDate(date) {
    selectedDate = date; renderCalendar(monthData); renderSlots();
  }
  function chooseSlot(slot) {
    pendingSlot = slot;
    $('reservationCard').hidden = false;
    $('selectedSlotLabel').textContent = `${formatDate(slot.date)} · ${slot.label}`;
    setMessage('reservationMessage', client ? '' : 'Sign in or create a client account below, then confirm this selected time.');
    $('reservationCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    renderCalendar(monthData);
  }
  async function loadMonth(month) {
    if (monthData?.month && monthData.month !== month) { selectedDate = ''; pendingSlot = null; $('reservationCard').hidden = true; }
    $('calendarMonthLabel').textContent = formatMonth(month);
    $('calendarStatus').textContent = 'Checking the practice calendar…';
    try {
      const data = await api(`/api/availability?month=${encodeURIComponent(month)}`);
      renderCalendar(data);
    } catch (error) {
      $('calendarDays').replaceChildren(); $('calendarSlots').innerHTML = '<p class="slot-empty">The calendar could not be loaded right now.</p>';
      $('calendarStatus').textContent = error.message; renderMeter({});
    }
  }
  async function loadSiteSettings() {
    try {
      const data = await api('/api/site');
      if (data.config && typeof data.config === 'object') site = { ...site, ...data.config, features: { ...site.features, ...(data.config.features || {}) } };
    } catch (_) { /* Use the generated public configuration if the settings API is unavailable. */ }
  }
  function populateServices() {
    const select = $('reservationService');
    const services = Array.isArray(site.services) && site.services.length ? site.services : ['Consultation', 'Follow-up'];
    services.forEach((service) => select.add(new Option(service, service)));
    $('reservationContextLabel').textContent = site.specialty === 'dental' ? 'Reason for your visit (optional)' : 'Pet name or note for the practice (optional)';
  }
  function paymentReminderDue(appointment) {
    const dueAt = new Date(appointment.paymentDueAt).getTime();
    return Boolean(appointment.paymentReminderSentAt) || (Number.isFinite(dueAt) && Date.now() >= dueAt - 3 * 60_000);
  }
  function formatPaymentFollowup(appointment) {
    const dueAt = new Date(appointment.paymentDueAt).getTime();
    if (!Number.isFinite(dueAt)) return 'Please upload proof when you can. The booking stays scheduled until the practice updates it.';
    const remaining = dueAt - Date.now();
    if (remaining <= 0) return 'The 15-minute check-in has passed. Your appointment remains scheduled while the practice verifies payment or releases the time.';
    if (remaining <= 3 * 60_000) return 'Please upload your transaction screenshot now. Your appointment remains scheduled while payment is checked.';
    const minutes = Math.ceil((remaining - 3 * 60_000) / 60_000);
    return `Please upload proof within 15 minutes. We’ll remind you in about ${minutes} minute${minutes === 1 ? '' : 's'} if it is still missing.`;
  }
  function paymentAccountDetails(method) {
    const payments = site.payments || {};
    const prefix = method === 'maya' ? 'maya' : 'gcash';
    return [payments[`${prefix}Name`], payments[`${prefix}Number`]].map((value) => String(value || '').trim()).filter(Boolean).join(' · ');
  }
  function addPaymentProofPanel(row, appointment) {
    const panel = document.createElement('div'); panel.className = `client-payment-panel payment-${appointment.paymentStatus || 'approved'}`;
    const heading = document.createElement('strong'); heading.className = 'client-payment-heading';
    const method = appointment.paymentMethod === 'maya' ? 'Maya' : 'GCash';
    const statuses = {
      awaiting_proof: 'Payment proof needed', pending_review: 'Payment proof uploaded · awaiting review',
      approved: 'Payment received', rejected: 'Payment rejected · time released', expired: 'Payment window expired · time released'
    };
    const cancelled = appointment.status === 'cancelled' && !['expired', 'rejected'].includes(appointment.paymentStatus);
    heading.textContent = `${method} · ${cancelled ? 'Appointment cancelled' : statuses[appointment.paymentStatus] || 'Payment status'}`;
    panel.appendChild(heading);
    const manuallyReceivedWithoutProof = appointment.paymentStatus === 'approved'
      && Boolean(appointment.paymentManualReceivedAt) && !appointment.paymentProofId;
    const missingProofCanBeUploaded = appointment.status !== 'cancelled' && !appointment.paymentProofId
      && (appointment.paymentStatus === 'awaiting_proof' || manuallyReceivedWithoutProof);
    if (missingProofCanBeUploaded) {
      if (manuallyReceivedWithoutProof) {
        const recipient = document.createElement('p'); recipient.className = 'client-payment-recipient';
        recipient.textContent = 'The practice confirmed your payment. You can attach the transaction screenshot to this booking.';
        panel.appendChild(recipient);
      } else {
        const details = paymentAccountDetails(appointment.paymentMethod);
        if (details) { const recipient = document.createElement('p'); recipient.className = 'client-payment-recipient'; recipient.textContent = `Send payment to ${method}: ${details}`; panel.appendChild(recipient); }
      }
      if (paymentReminderDue(appointment)) {
        const reminder = document.createElement('p'); reminder.className = 'payment-reminder-alert'; reminder.setAttribute('role', 'status');
        reminder.textContent = manuallyReceivedWithoutProof
          ? 'Payment reminder: the practice confirmed receipt, but your screenshot is still missing. Upload the transaction image to attach it to your booking.'
          : 'Payment reminder: please upload a screenshot of the successful transaction now. Your appointment remains scheduled while the practice checks payment.';
        panel.appendChild(reminder);
      }
      if (!manuallyReceivedWithoutProof) {
        const timer = document.createElement('small'); timer.className = 'client-payment-deadline'; timer.textContent = formatPaymentFollowup(appointment); panel.appendChild(timer);
      }
      const label = document.createElement('label'); label.className = 'payment-proof-upload-label'; label.textContent = 'Upload successful transaction screenshot';
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.required = true;
      const upload = document.createElement('button'); upload.type = 'button'; upload.className = 'payment-proof-upload-button'; upload.textContent = 'Upload payment proof';
      const message = document.createElement('small'); message.className = 'payment-proof-upload-message'; message.setAttribute('aria-live', 'polite'); message.textContent = 'PNG, JPEG or WebP · maximum 3 MB';
      upload.addEventListener('click', async () => {
        const screenshot = file.files?.[0];
        if (!screenshot) { file.reportValidity(); return; }
        upload.disabled = true; file.disabled = true; message.classList.remove('error'); message.textContent = 'Uploading securely…';
        try {
          if (!PAYMENT_PROOF_MIME_TYPES.includes(screenshot.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
          if (screenshot.size > MAX_PAYMENT_PROOF_BYTES) throw new Error('Payment screenshots must be 3 MB or smaller.');
          const result = await uploadPaymentProof(appointment.id, screenshot);
          message.textContent = result.proof?.status === 'approved'
            ? 'Proof uploaded. The practice has already confirmed payment.'
            : 'Proof uploaded. The practice owner will review it.';
          toast('Payment proof uploaded');
          await loadClientAppointments();
        } catch (error) { message.textContent = error.message; message.classList.add('error'); toast(error.message, true); }
        finally { upload.disabled = false; file.disabled = false; }
      });
      label.appendChild(file); panel.append(label, upload, message);
    } else if (appointment.paymentStatus === 'pending_review' && appointment.status !== 'cancelled') {
      const detail = document.createElement('p'); detail.className = 'client-payment-recipient';
      detail.textContent = appointment.paymentProofUploadedAt ? `Uploaded ${new Date(appointment.paymentProofUploadedAt).toLocaleString()}. The appointment remains held while the owner checks the receipt.` : 'The appointment remains held while the owner checks the receipt.';
      panel.appendChild(detail);
    } else if (appointment.paymentStatus === 'approved' && appointment.paymentManualReceivedAt && appointment.paymentProofId) {
      const detail = document.createElement('p'); detail.className = 'client-payment-recipient';
      detail.textContent = 'The practice confirmed payment and your transaction screenshot is on file.'; panel.appendChild(detail);
    } else if (cancelled || appointment.paymentStatus === 'expired' || appointment.paymentStatus === 'rejected') {
      const detail = document.createElement('p'); detail.className = 'client-payment-recipient'; detail.textContent = cancelled ? 'The practice released this booking. Contact them if you already sent payment.' : 'This appointment time is no longer reserved. Choose another open time to book again.'; panel.appendChild(detail);
    }
    row.appendChild(panel);
  }
  async function uploadPaymentProof(appointmentId, file) {
    if (!csrfToken) await getCsrf();
    const response = await fetch(`/api/client/appointments/${encodeURIComponent(appointmentId)}/payment-proof`, {
      method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': file.type, 'X-CSRF-Token': csrfToken }, body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Upload failed (${response.status}).`);
    return result;
  }
  function renderClientAppointments(appointments) {
    const list = $('clientAppointmentsList'); list.replaceChildren();
    if (!appointments.length) { const empty = document.createElement('p'); empty.className = 'slot-empty'; empty.textContent = 'No consultations are linked to this account yet.'; list.appendChild(empty); return; }
    appointments.forEach((appointment) => {
      const row = document.createElement('article'); row.className = 'client-appointment-row';
      const heading = document.createElement('div'); heading.className = 'client-appointment-heading';
      const date = document.createElement('strong'); date.textContent = `${formatDate(appointment.date)} · ${appointment.timeLabel || appointment.time}`;
      const paymentLabels = { awaiting_proof: paymentReminderDue(appointment) ? 'Proof reminder' : 'Awaiting proof', pending_review: 'Payment under review', approved: 'Payment received', rejected: 'Payment rejected', expired: 'Slot released' };
      const paymentStatus = appointment.paymentStatus || '';
      let stateText = appointment.status === 'cancelled' && !['expired', 'rejected'].includes(paymentStatus) ? 'Cancelled' : paymentLabels[paymentStatus] || (appointment.status === 'confirmed' ? 'Reserved' : appointment.status || 'Reserved');
      if (paymentStatus === 'approved' && appointment.paymentManualReceivedAt && !appointment.paymentProofId && paymentReminderDue(appointment)) stateText = 'Payment received · proof reminder';
      const state = document.createElement('span'); state.className = `client-appointment-status ${appointment.status === 'cancelled' || ['expired', 'rejected'].includes(paymentStatus) ? 'is-cancelled' : paymentStatus === 'approved' ? 'is-paid' : ''}`; state.textContent = stateText;
      heading.append(date, state);
      const detail = document.createElement('p'); detail.className = 'client-appointment-detail'; detail.textContent = `${appointment.service}${appointment.context ? ` · ${appointment.context}` : ''}`;
      row.append(heading, detail);
      if (paymentStatus) addPaymentProofPanel(row, appointment);
      if (appointment.noteBody) {
        const note = document.createElement('div'); note.className = 'private-consultation-note';
        const noteTitle = document.createElement('strong'); noteTitle.textContent = 'A private note from the practice';
        const noteBody = document.createElement('p'); noteBody.textContent = appointment.noteBody;
        const noteDate = document.createElement('small'); noteDate.textContent = appointment.noteUpdatedAt ? `Updated ${new Date(appointment.noteUpdatedAt).toLocaleDateString()}` : '';
        note.append(noteTitle, noteBody, noteDate); row.appendChild(note);
      }
      if (appointment.status !== 'cancelled') {
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'client-cancel-button'; cancel.textContent = 'Cancel consultation';
        cancel.addEventListener('click', () => cancelAppointment(appointment.id, appointment.date)); row.appendChild(cancel);
      }
      list.appendChild(row);
    });
  }
  async function loadClientAppointments() {
    if (!client) return;
    try { const data = await api('/api/client/appointments'); renderClientAppointments(data.appointments || []); }
    catch (error) { $('clientAppointmentsList').textContent = error.message; }
  }
  function showClient(account) {
    client = account || null;
    $('guestAccountPanel').hidden = Boolean(client);
    $('signedInAccountPanel').hidden = !client;
    if (!client) return;
    $('clientWelcome').textContent = `Hello, ${client.name}`;
    $('clientEmail').textContent = client.email;
    loadClientAppointments();
    if (pendingSlot) setMessage('reservationMessage', 'You are signed in. Choose a visit type and confirm your selected time.');
  }
  async function submitAuth(event, endpoint, formId, messageId) {
    event.preventDefault(); const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const body = Object.fromEntries(new FormData(form).entries());
    setMessage(messageId, 'One moment…');
    const button = form.querySelector('[type="submit"]'); if (button) button.disabled = true;
    try {
      const result = await api(endpoint, { method: 'POST', body });
      form.reset(); setMessage(messageId, ''); showClient(result.client); toast(endpoint.endsWith('register') ? 'Account created' : 'You are signed in');
    } catch (error) { setMessage(messageId, error.message, true); }
    finally { if (button) button.disabled = false; }
  }
  async function submitReservation(event) {
    event.preventDefault(); const form = event.currentTarget;
    if (!pendingSlot) { setMessage('reservationMessage', 'Choose an open time on the calendar first.', true); return; }
    if (!client) { setMessage('reservationMessage', 'Sign in or create a client account below to reserve this consultation.', true); $('clientAccountSection').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (!form.reportValidity()) return;
    const selectedPaymentMethod = $('reservationPaymentMethod').value;
    if (!paymentAccountDetails(selectedPaymentMethod)) { setMessage('reservationMessage', `The practice has not added ${selectedPaymentMethod === 'maya' ? 'Maya' : 'GCash'} payment details yet. Please contact the practice before booking.`, true); return; }
    const button = $('reserveButton'); button.disabled = true; setMessage('reservationMessage', 'Reserving your consultation…');
    try {
      await api('/api/appointments', { method: 'POST', body: { slotId: pendingSlot.id, service: $('reservationService').value, context: $('reservationContext').value.trim(), paymentMethod: $('reservationPaymentMethod').value } });
      setMessage('reservationMessage', 'Your appointment is scheduled. Upload the successful payment screenshot from your account; we will remind you after 12 minutes if proof is missing.');
      toast('Appointment scheduled · payment proof reminder after 12 minutes'); pendingSlot = null; $('reservationCard').hidden = true; form.reset();
      await loadMonth(monthData?.month || currentYearMonth()); await loadClientAppointments();
      $('clientAccountSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { setMessage('reservationMessage', error.message, true); await loadMonth(monthData?.month || currentYearMonth()); }
    finally { button.disabled = false; }
  }
  async function cancelAppointment(id, date) {
    if (!window.confirm(`Cancel your consultation on ${formatDate(date)}? The time will become available to another client.`)) return;
    try {
      await api(`/api/client/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'cancelled' } });
      toast('Consultation cancelled'); await loadMonth(monthData?.month || currentYearMonth()); await loadClientAppointments();
    } catch (error) { toast(error.message, true); }
  }
  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); }
    catch (error) { toast(error.message, true); return; }
    showClient(null); $('clientAppointmentsList').replaceChildren(); toast('You are signed out');
  }
  function bind() {
    $('previousMonth').addEventListener('click', () => loadMonth(monthShift(monthData?.month || currentYearMonth(), -1)));
    $('nextMonth').addEventListener('click', () => loadMonth(monthShift(monthData?.month || currentYearMonth(), 1)));
    $('clientLoginForm').addEventListener('submit', (event) => submitAuth(event, '/api/auth/login', 'clientLoginForm', 'loginMessage'));
    $('clientRegisterForm').addEventListener('submit', (event) => submitAuth(event, '/api/auth/register', 'clientRegisterForm', 'registerMessage'));
    $('reservationForm').addEventListener('submit', submitReservation);
    $('clientLogout').addEventListener('click', logout);
    $('refreshClientAppointments').addEventListener('click', loadClientAppointments);
  }
  async function initialize() {
    bind();
    await loadSiteSettings();
    populateServices();
    const month = currentYearMonth();
    if (!site.features?.scheduling) {
      $('calendarStatus').textContent = 'Online appointments are not enabled for this practice. Please contact the team.';
      $('reservationCard').hidden = true; $('clientAccountSection').classList.add('hidden');
    }
    await Promise.all([getCsrf().catch(() => {}), loadMonth(month)]);
    try { const result = await api('/api/auth/me'); if (result.client) showClient(result.client); }
    catch (_) { /* A visitor can still view published availability without signing in. */ }
    window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadMonth(monthData?.month || currentYearMonth());
      if (client) loadClientAppointments();
    }, 60_000);
  }
  initialize();
})();
