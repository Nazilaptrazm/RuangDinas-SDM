const defaultPlaces = [
  { name: 'Jakarta' },
  { name: 'Bandung' },
  { name: 'Yogyakarta' },
  { name: 'Surabaya' },
  { name: 'Lainnya' }
];
const ONLINE_FEE = 150000;
let tariffRows = [];
let positionTransportRates = [];
let trainingRateRows = [];
let mode = 'offline';
let selectedEmployee = null;
let participants = [];
let searchTimer;
const $ = id => document.getElementById(id);
const rupiah = value => 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
function terbilangRupiah(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  const words = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function spell(n) {
    if (n < 12) return words[n];
    if (n < 20) return `${spell(n - 10)} belas`;
    if (n < 100) return `${spell(Math.floor(n / 10))} puluh ${spell(n % 10)}`.trim();
    if (n < 200) return `seratus ${spell(n - 100)}`.trim();
    if (n < 1000) return `${spell(Math.floor(n / 100))} ratus ${spell(n % 100)}`.trim();
    if (n < 2000) return `seribu ${spell(n - 1000)}`.trim();
    for (const [scale, label] of [[1e12, 'triliun'], [1e9, 'miliar'], [1e6, 'juta'], [1e3, 'ribu']]) {
      if (n >= scale) return `${spell(Math.floor(n / scale))} ${label} ${spell(n % scale)}`.trim();
    }
  }
  const text = `${number === 0 ? 'nol' : spell(number)} rupiah`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const key = value => String(value || '').trim().toLocaleLowerCase('id-ID');
const locationKey = value => {
  const normalized = key(value).replace(/\s+/g, ' ');
  const aliases = {
    'sumatra utara': 'sumatera utara',
    'jakarta': 'dki jakarta',
    'yogyakarta': 'di yogyakarta'
  };
  return aliases[normalized] || normalized;
};
const requiresManualTransport = position => /^BOD[-_ ]?[1-5]$/i.test(String(position || '').trim());
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

$('today').textContent = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
}).format(new Date());

function placesList() {
  const places = [];
  const type = $('tripType')?.value || 'Dalam Negeri';
  const matches = tariffRows.filter(row => key(row.jenis_perjalanan) === key(type));
  places.push(...matches.map(row => ({ name: row.lokasi })));
  if (key(type) === key('Dalam Negeri')) {
    if (!tariffRows.length) places.push(...defaultPlaces);
    places.push(...trainingRateRows.map(row => ({ name: row.lokasi })));
  }
  return [...new Map(places.map(place => [locationKey(place.name), place])).values()];
}

function hotelClassForPosition(position) {
  const role = key(position).toUpperCase().replace(/\s+/g, '');
  if (['DEWANPENGAWAS', 'DIREKSI', 'DEWANPENGAWASDANDIREKSI', 'BOD-1'].includes(role)) return 'Bintang 5';
  if (/^BOD-[2-5]$/.test(role)) return 'Bintang 4';
  return 'Belum ditentukan';
}

function buildOptions(placeValue) {
  const places = placesList();
  $('placeLabel').textContent = key($('tripType').value) === key('Luar Negeri')
    ? 'Negara tujuan' : 'Provinsi/daerah pelatihan';
  $('place').innerHTML = places.map(place =>
    `<option value="${escapeHtml(place.name)}">${escapeHtml(place.name)}</option>`).join('');
  if (!places.length) {
    const destination = key($('tripType').value) === key('Luar Negeri') ? 'negara tujuan luar negeri' : 'provinsi dalam negeri';
    $('place').innerHTML = `<option value="">Daftar ${destination} belum tersedia</option>`;
  }
  if (placeValue && places.some(place => locationKey(place.name) === locationKey(placeValue))) {
    $('place').value = places.find(place => locationKey(place.name) === locationKey(placeValue)).name;
  }
  $('rateCount').textContent = tariffRows.length ? `${tariffRows.length} kombinasi` : 'Belum diimpor';
}

function currentTariff(employee = selectedEmployee, personInput = {}) {
  const roleName = employee?.jabatan || '';
  const placeName = $('place').value;
  const travelType = $('tripType').value;
  const isForeign = travelType === 'Luar Negeri';
  const exchangeRate = Math.max(0, Number($('exchangeRate').value) || 0);
  const manualRequired = requiresManualTransport(roleName);
  const transportChoice = personInput.transportChoice || '';
  const manualValue = String(personInput.manualTransport || '').trim();
  const manualTransport = manualValue === '' ? 0 : Math.max(0, Number(manualValue) || 0);
  const fixedTransport = positionTransportRates.find(row => key(row.jabatan) === key(roleName));
  const trainingRate = trainingRateRows.find(row => locationKey(row.lokasi) === locationKey(placeName));
  const trainingData = { uang_diklat: Number(trainingRate?.uang_diklat) || 0, biaya_diklat_tersedia: Boolean(trainingRate) };
  if (!roleName) return {
    jenis_perjalanan: travelType, jabatan: '', lokasi: placeName, uang_harian: 0, uang_transportasi: 0,
    transportasi_tersedia: false, biaya_pelatihan_online: ONLINE_FEE, ...trainingData, source: 'belum dipilih'
  };
  const imported = tariffRows.find(row => key(row.jenis_perjalanan) === key(travelType)
    && key(row.jabatan) === key(roleName) && locationKey(row.lokasi) === locationKey(placeName));
  const transportAvailable = manualRequired
    ? (transportChoice === 'manual' ? manualValue !== '' : transportChoice !== '')
    : Boolean(fixedTransport || imported?.transportasi_tersedia);
  const transportValue = manualRequired
    ? (transportChoice === 'manual' ? manualTransport : Number(transportChoice) || 0)
    : (fixedTransport?.uang_transportasi ?? imported?.uang_transportasi ?? 0);
  if (imported) return {
    ...imported, ...trainingData,
    uang_harian_usd: isForeign ? Number(imported.uang_harian) || 0 : null,
    exchangeRate: isForeign ? exchangeRate : null,
    uang_harian: isForeign ? Math.round((Number(imported.uang_harian) || 0) * exchangeRate) : imported.uang_harian,
    uang_transportasi: transportValue, transportasi_tersedia: transportAvailable,
    transportasi_manual: manualRequired, source: 'CSV'
  };

  return {
    jenis_perjalanan: travelType,
    jabatan: roleName,
    lokasi: placeName,
    uang_harian: 0,
    uang_transportasi: transportValue,
    transportasi_tersedia: transportAvailable,
    transportasi_manual: manualRequired,
    biaya_pelatihan_offline: 0,
    biaya_pelatihan_online: ONLINE_FEE,
    ...trainingData,
    source: 'belum diimpor'
  };
}

function updateEmployeeDetail(tariff) {
  if (!selectedEmployee) return;
  const transportLabel = tariff.transportasi_manual
    ? 'Pilih nominal transportasi pada formulir'
    : tariff.transportasi_tersedia === false ? 'Belum diimpor' : rupiah(tariff.uang_transportasi);
  const hotelClass = hotelClassForPosition(selectedEmployee.jabatan);
  $('employeeDetail').classList.add('selected');
  $('employeeDetail').innerHTML = `<b>NIK</b> ${escapeHtml(selectedEmployee.nik)} &nbsp;·&nbsp; <b>Nama</b> ${escapeHtml(selectedEmployee.nama)}<br>
    <b>Jabatan</b> ${escapeHtml(selectedEmployee.jabatan || '—')} &nbsp;·&nbsp; <b>Golongan</b> ${escapeHtml(selectedEmployee.golongan || '—')}<br>
    <b>Unit kerja</b> ${escapeHtml(selectedEmployee.unit_kerja || '—')} &nbsp;·&nbsp; <b>Divisi</b> ${escapeHtml(selectedEmployee.divisi || '—')}<br>
    <b>Kelas hotel</b> ${hotelClass}<br>
    <b>Jenis perjalanan</b> ${escapeHtml(tariff.jenis_perjalanan)} · ${escapeHtml(tariff.lokasi)}<br>
    <b>Uang harian</b> ${tariff.uang_harian_usd !== null && tariff.uang_harian_usd !== undefined ? `USD ${tariff.uang_harian_usd} × ${rupiah(tariff.exchangeRate)} = ` : ''}${rupiah(tariff.uang_harian)} / hari &nbsp;·&nbsp; <b>Transport</b> ${transportLabel}<br>
    <b>Uang diklat</b> ${tariff.biaya_diklat_tersedia ? `${rupiah(tariff.uang_diklat)} / hari` : 'Belum diimpor'}<br>
    <b>Tarif</b> ${tariff.source === 'CSV' ? 'data impor' : tariff.source === 'contoh' ? 'contoh sementara' : 'belum diimpor'}`;
}

function discountedDailyAmount(rate, fullDays, reducedDays) {
  const dailyRate = Math.max(0, Number(rate) || 0);
  const regularDays = Math.max(0, Number(fullDays) || 0);
  const discountedDays = Math.max(0, Number(reducedDays) || 0);
  const discountedRate = Math.round(dailyRate * 0.75);
  const total = dailyRate * regularDays + discountedRate * discountedDays;
  const detail = discountedDays
    ? `${rupiah(dailyRate)} × ${regularDays} hari penuh + ${rupiah(discountedRate)} × ${discountedDays} hari (75%)`
    : `${rupiah(dailyRate)} × ${regularDays} hari`;
  return { total, detail, regularDays, discountedDays, discountedRate };
}

function calculate() {
  const isForeign = $('tripType').value === 'Luar Negeri';
  $('exchangeRateField').hidden = !isForeign;
  document.querySelectorAll('[data-offline-cost]').forEach(el => el.hidden = mode === 'online');
  const singleDays = Math.max(1, parseInt($('days').value, 10) || 1);
  const offlineDays = mode === 'gabungan'
    ? Math.max(1, parseInt($('offlineDays').value, 10) || 1)
    : (mode === 'offline' ? singleDays : 0);
  const onlineDays = mode === 'gabungan'
    ? Math.max(1, parseInt($('onlineDays').value, 10) || 1)
    : (mode === 'online' ? singleDays : 0);
  // Combined schedules currently contain day counts only; assume offline days occur first.
  const regularOfflineDays = Math.min(offlineDays, 5);
  const reducedOfflineDays = Math.max(0, offlineDays - 5);
  const regularOnlineDays = Math.min(onlineDays, Math.max(0, 5 - offlineDays));
  const reducedOnlineDays = Math.max(0, onlineDays - regularOnlineDays);
  const items = [];
  const participantEstimates = participants.map(person => {
    const employee = person.employee;
    const tariff = { ...currentTariff(employee, person), biaya_pelatihan_offline: 0, biaya_pelatihan_online: ONLINE_FEE };
    const hotelClass = hotelClassForPosition(employee.jabatan);
    const personItems = [];
    if (mode !== 'online') {
      const daily = discountedDailyAmount(tariff.uang_harian, regularOfflineDays, reducedOfflineDays);
      personItems.push([`Uang harian`, daily.total, `${isForeign ? `USD ${tariff.uang_harian_usd || 0} × kurs ${rupiah(tariff.exchangeRate)} · ` : ''}${daily.detail}`]);
      if (tariff.biaya_diklat_tersedia) {
        personItems.push([`Uang diklat`, tariff.uang_diklat * offlineDays,
          `${rupiah(tariff.uang_diklat)} × ${offlineDays} hari penuh · tidak terkena potongan durasi`]);
      }
      if (tariff.transportasi_tersedia !== false) {
        personItems.push([`Transportasi`, tariff.uang_transportasi, 'Satu kali per peserta · pulang-pergi']);
      }
    }
    if (mode === 'online' || mode === 'gabungan') {
      const online = discountedDailyAmount(tariff.biaya_pelatihan_online, regularOnlineDays, reducedOnlineDays);
      personItems.push([`Pelatihan online`, online.total, online.detail]);
    }
    const lodgingInput = String(person.lodgingCost || '').trim();
    const lodgingCost = mode === 'online' || lodgingInput === '' ? 0 : Math.max(0, Number(lodgingInput) || 0);
    if (mode !== 'online' && lodgingInput !== '') {
      personItems.push([`Penginapan`, lodgingCost, `Total manual · ${hotelClass}`]);
    }
    const registrationInput = String(person.registrationFee || '').trim();
    const registrationFee = registrationInput === '' ? 0 : Math.max(0, Number(registrationInput) || 0);
    if (registrationInput !== '') {
      personItems.push([`Pendaftaran pelatihan`, registrationFee, 'Biaya manual satu kali per peserta']);
    }
    items.push(...personItems);
    return {
      employee, tariff, hotelClass, personItems, lodgingCost,
      lodgingEntered: mode !== 'online' && lodgingInput !== '',
      registrationFee, registrationEntered: registrationInput !== ''
    };
  });
  const total = items.reduce((sum, item) => sum + item[1], 0);
  $('grandTotal').textContent = rupiah(total);
  $('totalWords').textContent = terbilangRupiah(total);
  $('perPerson').textContent = rupiah(total);
  $('summaryTitle').textContent = `Ringkasan anggaran · ${participants.length} peserta`;
  $('breakdown').innerHTML = participantEstimates.map(person => `<div class="budget-person"><strong>${escapeHtml(person.employee.nama)}</strong><span>${rupiah(person.personItems.reduce((sum, item) => sum + item[1], 0))}</span></div>` + person.personItems.map(([label, amount, detail]) => `<div class="line-item"><div class="line-label">${escapeHtml(label)}<small>${escapeHtml(detail)}</small></div><div class="line-amount">${rupiah(amount)}</div></div>`).join('')).join('') || '<div class="line-item"><div class="line-label">Belum ada peserta<small>Cari dan pilih karyawan untuk menambahkan peserta.</small></div></div>';


  const descriptions = {
    offline: 'Uang harian dibayar 100% untuk hari 1–5 dan 75% mulai hari ke-6. Uang diklat tetap 100% setiap hari.',
    online: 'Biaya online Rp150.000 per hari; hari 1–5 dibayar 100% dan mulai hari ke-6 dibayar 75%.',
    gabungan: 'Anggaran dihitung per peserta dengan hari offline lebih dulu, lalu online. Uang diklat tetap 100% setiap hari offline.'
  };
  $('singleDurationField').hidden = mode === 'gabungan';
  $('offlineDurationField').hidden = mode !== 'gabungan';
  $('onlineDurationField').hidden = mode !== 'gabungan';
  const missingTransport = participantEstimates.filter(item => mode !== 'online' && item.tariff.transportasi_tersedia === false);
  const missingTraining = participantEstimates.filter(item => mode !== 'online' && !item.tariff.biaya_diklat_tersedia);
  const missingRates = participantEstimates.filter(item => item.tariff.source === 'belum diimpor');
  const notes = [descriptions[mode]];
  if (isForeign && !(Number($('exchangeRate').value) > 0)) notes.push('Masukkan kurs dolar hari ini agar uang harian luar negeri dapat dihitung.');
  if (!participants.length) notes.push('Pilih karyawan dari hasil pencarian.');
  if (missingRates.length) notes.push(`Tarif belum tersedia untuk: ${missingRates.map(item => item.employee.nama).join(', ')}.`);
  if (missingTransport.length) notes.push(`Pilih/isi biaya transportasi untuk: ${missingTransport.map(item => item.employee.nama).join(', ')}.`);
  if (missingTraining.length) notes.push(`Tarif uang diklat belum tersedia untuk: ${missingTraining.map(item => item.employee.nama).join(', ')}.`);
  $('modeNote').textContent = notes.join(' ');

  window.currentEstimate = {
    participants: participantEstimates,
    tripType: $('tripType').value, location: $('place').value,
    exchangeRate: isForeign ? Math.max(0, Number($('exchangeRate').value) || 0) : null,
    mode, days: mode === 'gabungan' ? null : singleDays,
    offlineDays, onlineDays, regularOfflineDays, reducedOfflineDays,
    regularOnlineDays, reducedOnlineDays, items, total, perPerson: total
  };
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2300);
}

function closeModal() {
  $('modalBackdrop').classList.remove('open');
}

function downloadCsv(filename, header) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + header + '\n'], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function importCsv(file, endpoint, statusElement, onSuccess) {
  if (!file) return;
  statusElement.textContent = 'Mengimpor data…';
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'text/csv;charset=utf-8' }, body: await file.text()
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Impor gagal');
    statusElement.textContent = `Berhasil: ${result.imported} baris disimpan/diperbarui. Dilewati: ${result.skipped} baris.`;
    toast('CSV berhasil diimpor');
    if (onSuccess) await onSuccess();
  } catch (error) {
    statusElement.textContent = error.message || 'Tidak dapat menghubungi database. Pastikan server berjalan.';
  }
}

async function refreshTariffs() {
  const response = await fetch('/api/rates');
  const data = await response.json();
  const place = $('place').value;
  tariffRows = data.rates || [];
  positionTransportRates = data.position_transport_rates || [];
  trainingRateRows = data.training_allowances || [];
  buildOptions(place);
  calculate();
}

function openDataManager() {
  $('modalTitle').textContent = 'Impor CSV karyawan dan tarif';
  $('modalBody').innerHTML = `<p>Impor data karyawan dan tabel tarif secara terpisah. Uang diklat mengikuti daerah, sama untuk BOD-1 sampai BOD-5, dan dihitung per hari kegiatan offline.</p>
    <div class="import-box"><label>1. CSV karyawan & jabatan</label><button class="btn" id="employeeTemplate" type="button">↓ &nbsp; Unduh template karyawan</button>
      <div style="margin:12px 0 7px"><input id="employeeCsv" type="file" accept=".csv,text/csv"></div>
      <div class="import-help">Kolom wajib: NIK, Nama, dan Jabatan. CSV dengan pemisah koma atau titik koma bisa digunakan; kolom tambahan seperti Unit Kerja, Divisi, dan Uraian akan ikut disimpan. Format jabatan BOD 3 juga dikenali sebagai BOD-3.</div>
      <div id="employeeImportStatus" class="import-help" style="margin-top:8px"></div></div>
    <div class="import-box"><label>2. CSV uang harian & transportasi</label><button class="btn" id="rateTemplate" type="button">↓ &nbsp; Unduh template tarif</button>
      <div style="margin:12px 0 7px"><input id="rateCsv" type="file" accept=".csv,text/csv"></div>
      <div class="import-help">Kolom: <b>jenis_perjalanan,jabatan,lokasi,uang_harian,uang_transportasi</b>. Jenis perjalanan diisi <b>Dalam Negeri</b> atau <b>Luar Negeri</b>; jabatan harus sama dengan CSV karyawan. Isi satu baris per jenis perjalanan, jabatan, dan lokasi. Biaya online tetap Rp150.000 per hari.</div>
      <div id="rateImportStatus" class="import-help" style="margin-top:8px"></div></div>`;
  $('modalBody').insertAdjacentHTML('beforeend', `<div class="import-box"><label>3. CSV tabel uang harian Dalam Negeri</label>
      <div style="margin:12px 0 7px"><input id="dailyCsv" type="file" accept=".csv,text/csv"></div>
      <div class="import-help">Impor file uang harian berbentuk tabel daerah pada kolom ketiga dan jabatan BOD-1 sampai BOD-5 pada baris kedua. Tarif transportasi belum ada di file ini dan dapat dimasukkan terpisah.</div>
      <div id="dailyImportStatus" class="import-help" style="margin-top:8px"></div></div>
    <div class="import-box"><label>4. CSV tabel uang harian Luar Negeri</label>
      <div style="margin:12px 0 7px"><input id="foreignDailyCsv" type="file" accept=".csv,text/csv"></div>
      <div class="import-help">Jabatan BOD-1 sampai BOD-5 akan dicocokkan dengan data karyawan. Kolom Dewan Pengawas dan Direksi tidak dipakai. Angka uang harian harus dalam USD; konversi rupiah memakai kurs pada formulir. Tarif transportasi belum ada di file ini.</div>
      <div id="foreignDailyImportStatus" class="import-help" style="margin-top:8px"></div></div>
    <div class="import-box"><label>5. CSV biaya transportasi (opsional)</label>
      <div style="margin:12px 0 7px"><input id="transportCsv" type="file" accept=".csv,text/csv"></div>
      <div class="import-help">Tarif CSV digunakan untuk jabatan di luar BOD-1 sampai BOD-5. Untuk BOD-1 sampai BOD-5, pilih Rp300.000, Rp400.000, Rp500.000, atau masukkan nominal manual setelah karyawan dipilih.</div>
      <div id="transportImportStatus" class="import-help" style="margin-top:8px"></div></div>
    <div class="import-box"><label>Uang diklat otomatis</label>
      <div class="import-help">Tarif per provinsi dimuat otomatis dari data aplikasi, sama untuk BOD-1 sampai BOD-5, dan dihitung per hari kegiatan offline.</div></div>`);
  $('modalBackdrop').classList.add('open');
  $('employeeTemplate').addEventListener('click', () => downloadCsv('template-karyawan-sppd.csv', 'nik,nama,jabatan,golongan,unit_kerja'));
  $('rateTemplate').addEventListener('click', () => downloadCsv('template-tarif-sppd.csv', 'jenis_perjalanan,jabatan,lokasi,uang_harian,uang_transportasi'));
  $('employeeCsv').addEventListener('change', event =>
    importCsv(event.target.files[0], '/api/employees/import', $('employeeImportStatus')));
  $('rateCsv').addEventListener('change', event =>
    importCsv(event.target.files[0], '/api/rates/import', $('rateImportStatus'), refreshTariffs));
  $('dailyCsv').addEventListener('change', event =>
    importCsv(event.target.files[0], '/api/daily-rates/import', $('dailyImportStatus'), refreshTariffs));
  $('foreignDailyCsv').addEventListener('change', event =>
    importCsv(event.target.files[0], '/api/daily-rates/foreign/import', $('foreignDailyImportStatus'), refreshTariffs));
  $('transportCsv').addEventListener('change', event =>
    importCsv(event.target.files[0], '/api/transport-rates/import', $('transportImportStatus'), refreshTariffs));
}

function renderEmployeeResults(employees) {
  const results = $('employeeResults');
  if (!employees.length) {
    results.innerHTML = '<div class="employee-option"><small>Tidak ada hasil yang cocok.</small></div>';
    results.classList.add('open');
    return;
  }
  results.innerHTML = employees.map((employee, index) =>
    `<div class="employee-option" data-result="${index}"><b>${escapeHtml(employee.nama)}</b><small>NIK ${escapeHtml(employee.nik)} · ${escapeHtml(employee.jabatan || 'Jabatan belum diisi')} · ${escapeHtml(employee.unit_kerja || 'Unit belum diisi')}</small></div>`
  ).join('');
  results.classList.add('open');
  results.querySelectorAll('[data-result]').forEach(option =>
    option.addEventListener('click', () => selectEmployee(employees[Number(option.dataset.result)])));
}

function renderParticipants() {
  const moneyInput = (person, index, field, label, offline = false) => `<div class="field" ${offline ? 'data-offline-cost' : ''} ${offline && mode === 'online' ? 'hidden' : ''}><label for="${field}-${index}">${label}</label><div class="suffix-wrap"><span class="suffix" style="left:13px;right:auto">Rp</span><input id="${field}-${index}" data-index="${index}" data-field="${field}" type="number" min="0" step="1000" style="padding-left:42px" placeholder="Masukkan nominal" value="${escapeHtml(person[field])}"/></div></div>`;
  $('participantList').innerHTML = `<div class="participants-title">Peserta perjalanan <span>${participants.length} orang</span></div>` + (participants.map((person, index) => `<article class="participant-card"><div class="participant-head"><div><strong>${index + 1}. ${escapeHtml(person.employee.nama)}</strong><small>NIK ${escapeHtml(person.employee.nik)} · ${escapeHtml(person.employee.jabatan)} · ${escapeHtml(person.employee.unit_kerja || '—')}</small></div><button class="btn text" type="button" data-remove="${index}" aria-label="Hapus ${escapeHtml(person.employee.nama)}">Hapus</button></div><div class="participant-fields">${requiresManualTransport(person.employee.jabatan) ? `<div class="field" data-offline-cost ${mode === 'online' ? 'hidden' : ''}><label for="transportChoice-${index}">Transportasi pulang-pergi</label><select id="transportChoice-${index}" data-index="${index}" data-field="transportChoice">${[['','Pilih nominal'],['300000','Rp300.000'],['400000','Rp400.000'],['500000','Rp500.000'],['manual','Nominal manual']].map(([v,l]) => `<option value="${v}" ${person.transportChoice === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div data-manual-index="${index}" ${person.transportChoice !== 'manual' || mode === 'online' ? 'hidden' : ''}>${moneyInput(person,index,'manualTransport','Transportasi manual')}</div>` : ''}${moneyInput(person,index,'lodgingCost',`Penginapan · ${hotelClassForPosition(person.employee.jabatan)}`,true)}${moneyInput(person,index,'registrationFee','Pendaftaran pelatihan')}</div></article>`).join('') || '<div class="participant-empty">Belum ada peserta. Tambahkan melalui pencarian karyawan di atas.</div>');
}
function selectEmployee(employee) {
  if (participants.some(person => String(person.employee.nik) === String(employee.nik))) { toast('Karyawan sudah ada di daftar peserta'); return; }
  participants.push({employee, transportChoice:'', manualTransport:'', lodgingCost:'', registrationFee:''});
  $('employeeSearch').value = '';
  $('employeeResults').classList.remove('open');
  renderParticipants(); calculate();
}
$('participantList').addEventListener('input', event => {
  const input = event.target.closest('[data-field]');
  if (!input) return;
  participants[Number(input.dataset.index)][input.dataset.field] = input.value;
  const manual = document.querySelector(`[data-manual-index="${input.dataset.index}"]`);
  if (manual) manual.hidden = mode === 'online' || participants[Number(input.dataset.index)].transportChoice !== 'manual';
  calculate();
});
$('participantList').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  participants.splice(Number(button.dataset.remove),1); renderParticipants(); calculate();
});

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    renderParticipants();
    document.querySelectorAll('[data-mode]').forEach(option => option.classList.toggle('active', option === button));
    calculate();
  });
});
['place', 'days', 'offlineDays', 'onlineDays', 'exchangeRate'].forEach(id => $(id).addEventListener('input', calculate));
['place'].forEach(id => $(id).addEventListener('change', calculate));
$('tripType').addEventListener('change', () => {
  const place = $('place').value;
  buildOptions(place);
  calculate();
});
$('manageEmployees').addEventListener('click', openDataManager);
$('closeModal').addEventListener('click', closeModal);
$('modalBackdrop').addEventListener('click', event => {
  if (event.target === $('modalBackdrop')) closeModal();
});
$('employeeSearch').addEventListener('input', () => {
  selectedEmployee = null;

  $('person').value = '';
  $('employeeDetail').classList.remove('selected');
  $('employeeDetail').textContent = 'Pilih hasil pencarian untuk menambahkan peserta. Biaya setiap peserta dapat diisi terpisah.';
  const query = $('employeeSearch').value.trim();
  clearTimeout(searchTimer);
  if (query.length < 2) {
    $('employeeResults').classList.remove('open');
    calculate();
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/employees?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Layanan database tidak tersedia.');
      renderEmployeeResults(data.employees || []);
    } catch (error) {
      const message = error instanceof TypeError
        ? 'Tidak dapat terhubung ke database. Periksa koneksi internet atau konfigurasi DATABASE_URL di Vercel.'
        : (error.message || 'Layanan database tidak tersedia.');
      $('employeeResults').innerHTML = `<div class="employee-option"><small>${escapeHtml(message)}</small></div>`;
      $('employeeResults').classList.add('open');
    }
  }, 180);
  calculate();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.employee-search')) $('employeeResults').classList.remove('open');
});
$('resetBtn').addEventListener('click', () => {
  participants = [];
  renderParticipants();
  selectedEmployee = null;

  $('exchangeRate').value = '';
  $('person').value = '';
  $('employeeSearch').value = '';
  $('employeeDetail').classList.remove('selected');
  $('employeeDetail').textContent = 'Pilih hasil pencarian untuk menambahkan peserta. Biaya setiap peserta dapat diisi terpisah.';
  $('tripType').value = 'Dalam Negeri';
  buildOptions(defaultPlaces[0].name);
  $('days').value = 3;
  $('offlineDays').value = 3;
  $('onlineDays').value = 2;
  mode = 'offline';
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  calculate();
});

function xmlEscape(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xlsxCell(reference, value, style = 0) {
  if (value === null || value === undefined || value === '') return `<c r="${reference}" s="${style}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function xlsxRow(rowNumber, cells, height) {
  const content = cells.map(([column, value, style]) => xlsxCell(`${column}${rowNumber}`, value, style)).join('');
  return `<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ''}>${content}</row>`;
}

function zipStored(files) {
  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  const crc32 = bytes => {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const parts = [];
  const central = [];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    parts.push(local);

    const directory = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(directory.buffer);
    dv.setUint32(0, 0x02014B50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, dosTime, true);
    dv.setUint16(14, dosDate, true); dv.setUint32(16, checksum, true); dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true); dv.setUint16(28, nameBytes.length, true); dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true); dv.setUint16(34, 0, true); dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true); dv.setUint32(42, offset, true); directory.set(nameBytes, 46);
    central.push(directory);
    offset += local.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054B50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function buildEstimateWorkbook(data) {
  const people = data.participants || [];
  const showOnline = data.mode === 'online' || data.mode === 'gabungan';
  const columns = (showOnline ? 'ABCDEFGHIJKLM' : 'ABCDEFGHIJKL').split('');
  const lastColumn = columns[columns.length - 1];
  const lastCostColumn = columns[columns.length - 2];
  const headers = ['No', 'Nama', 'NIK', 'Jabatan / Bidang Tugas', 'Unit Kerja', 'Jml Hari', 'Uang Saku / Diklat\nRp', 'Uang Harian\nRp', 'Transportasi\n1 × PP\nRp', 'Biaya Partisipasi / Pendaftaran (Non PKP)\nRp', 'Penginapan\nRp', ...(showOnline ? ['Biaya Online\nRp'] : []), 'Jumlah yang Dibayarkan\nRp'];
  const rows = [];
  const merges = [`A1:${lastColumn}1`];
  rows.push(xlsxRow(1, [['A', 'RINCIAN BIAYA SURAT PERINTAH PERJALANAN DINAS DIKLAT', 1]], 30));
  const headerRow = 3;
  rows.push(xlsxRow(headerRow, headers.map((value, index) => [columns[index], value, 3]), 76));
  rows.push(xlsxRow(4, columns.map((column, index) => [column, index === columns.length - 1 ? `${columns.length} = (7 s/d ${columns.length - 1})` : index + 1, 3]), 20));
  const componentTotal = (person, label) => person.personItems.reduce((sum, item) => item[0] === label ? sum + (Number(item[1]) || 0) : sum, 0);
  const amounts = people.map(person => [componentTotal(person, 'Uang diklat'), componentTotal(person, 'Uang harian'), componentTotal(person, 'Transportasi'), componentTotal(person, 'Pendaftaran pelatihan'), componentTotal(person, 'Penginapan'), ...(showOnline ? [componentTotal(person, 'Pelatihan online')] : [])]);
  const totals = Array(showOnline ? 6 : 5).fill(0);
  people.forEach((person, index) => {
    const row = 5 + index;
    const employee = person.employee;
    const values = [index + 1, employee.nama, String(employee.nik || ''), [employee.jabatan, employee.uraian].filter(Boolean).join('\n'), employee.unit_kerja || '—', data.offlineDays + data.onlineDays, ...amounts[index]];
    amounts[index].forEach((value, i) => totals[i] += value);
    const total = amounts[index].reduce((sum, value) => sum + value, 0);
    const cells = values.map((value, i) => xlsxCell(`${columns[i]}${row}`, value, i >= 6 ? 5 : i === 0 || i === 2 || i === 5 ? 4 : 6)).join('');
    rows.push(`<row r="${row}" ht="72" customHeight="1">${cells}<c r="${lastColumn}${row}" s="7"><f>SUM(G${row}:${lastCostColumn}${row})</f><v>${total}</v></c></row>`);
  });
  const totalRow = 5 + people.length;
  merges.push(`A${totalRow}:E${totalRow}`);
  const totalCells = [xlsxCell(`A${totalRow}`, 'Jumlah:', 8), ...['B','C','D','E'].map(c => xlsxCell(`${c}${totalRow}`, '', 8)), xlsxCell(`F${totalRow}`, '—', 3)];
  for (let i = 0; i < totals.length; i++) {
    const c = columns[i + 6];
    totalCells.push(`<c r="${c}${totalRow}" s="7"><f>${people.length ? `SUM(${c}5:${c}${totalRow - 1})` : '0'}</f><v>${totals[i]}</v></c>`);
  }
  const grandTotal = totals.reduce((sum, value) => sum + value, 0);
  totalCells.push(`<c r="${lastColumn}${totalRow}" s="7"><f>SUM(G${totalRow}:${lastCostColumn}${totalRow})</f><v>${grandTotal}</v></c>`);
  rows.push(`<row r="${totalRow}" ht="28" customHeight="1">${totalCells.join('')}</row>`);
  const wordsRow = totalRow + 2;
  rows.push(xlsxRow(wordsRow, [['A', `Terbilang: ${terbilangRupiah(grandTotal).toUpperCase()}`, 9]], 38));
  merges.push(`A${wordsRow}:${lastColumn}${wordsRow}`);
  const notes = [];
  if (data.mode === 'gabungan') notes.push('Perhitungan durasi mengasumsikan offline lebih dahulu, lalu online.');
  if (!people.length) notes.push('Pilih karyawan sebelum menetapkan anggaran.');
  if (data.tripType === 'Luar Negeri' && !data.exchangeRate) notes.push('Kurs USD belum diisi; uang harian luar negeri belum dihitung.');
  for (const person of people) {
    if (data.mode !== 'online' && person.tariff.transportasi_tersedia === false) notes.push('Transportasi belum diisi / tarif belum tersedia.');
    if (data.mode !== 'online' && !person.lodgingEntered) notes.push('Penginapan belum diisi.');
    if (data.mode !== 'online' && !person.tariff.biaya_diklat_tersedia) notes.push('Tarif uang diklat belum tersedia.');
  }
  const noteRow = wordsRow + 2;
  if (notes.length) {
    rows.push(xlsxRow(noteRow, [['A', notes.join(' '), 2]], 48));
    merges.push(`A${noteRow}:${lastColumn}${noteRow}`);
  }
  const widths = [5, 27, 15, 28, 19, 7, 16, 16, 16, 23, 16, ...(showOnline ? [16] : []), 20];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastColumn}${noteRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const xf = (fontId, borderId, horizontal, numFmtId = 0) => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="${borderId}" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${horizontal}" vertical="center" wrapText="1"/></xf>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF333333"/></left><right style="thin"><color rgb="FF333333"/></right><top style="thin"><color rgb="FF333333"/></top><bottom style="thin"><color rgb="FF333333"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10">${xf(0,0,'left')}${xf(2,0,'center')}${xf(0,0,'left')}${xf(1,1,'center')}${xf(0,1,'center')}${xf(0,1,'right',164)}${xf(0,1,'left')}${xf(1,1,'right',164)}${xf(1,1,'right')}${xf(1,0,'left')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Rincian Anggaran" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Rincian Anggaran'!$A$1:$${lastColumn}$${noteRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Rincian Anggaran'!$3:$4</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet
  };
  return zipStored(files);
}

$('exportBtn').addEventListener('click', () => {
  const data = window.currentEstimate;
  const workbook = buildEstimateWorkbook(data);
  const url = URL.createObjectURL(workbook);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Rincian_Anggaran_${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
  toast('File Excel berhasil diunduh');
});

async function init() {
  buildOptions('Jakarta');
  renderParticipants();
  try {
    const response = await fetch('/api/rates');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Database tidak dapat dihubungi.');
    tariffRows = data.rates || [];
    positionTransportRates = data.position_transport_rates || [];
    trainingRateRows = data.training_allowances || [];
    buildOptions('Jakarta');
    $('dbAlert').hidden = true;
  } catch (error) {
    $('rateCount').textContent = 'Database bermasalah';
    $('dbAlertMessage').textContent = error.message || 'Database tidak dapat dihubungi.';
    $('dbAlert').hidden = false;
    toast(error.message || 'Database tidak dapat dihubungi.');
  }
  calculate();
}
$('retryDatabase').addEventListener('click', init);
$('navGuide').addEventListener('click', () => toast('Pilih karyawan, jenis pelatihan, lokasi, dan durasi; lalu unduh rincian anggaran.'));
init();
