# Ruang Dinas — Anggaran SPPD

Ruang Dinas menyediakan dua cara menjalankan aplikasi: server lokal memakai SQLite (`sppd.db`), sedangkan deployment Vercel dapat membaca SQLite bawaan tanpa PostgreSQL. Vercel menggunakan database bawaan dalam mode baca saja agar perubahan tidak hilang ketika function dimulai ulang. PostgreSQL tetap opsional jika ingin menyimpan impor dari website.

## Menjalankan

1. Pastikan Python 3 tersedia.
2. Jalankan server:
   ```sh
   python3 app.py
   ```
3. Buka `http://127.0.0.1:8000` di browser pada komputer server. Berkas `index.html`, `app.js`, dan `style.css` berada di folder utama; jangan membuka HTML langsung melalui `file://`, karena fitur database memerlukan server.
4. Pilih **Kelola karyawan** untuk mengimpor data karyawan dan tarif sesuai jenis perjalanannya.
5. Klik **Unduh Excel (.xlsx)** pada ringkasan untuk menyimpan hasil dalam format laporan.

CSV data karyawan memerlukan kolom NIK, Nama, dan Jabatan. Pemisah koma dan titik koma didukung. Header tambahan seperti `Unit Kerja`, `Divisi`, dan `Uraian` ikut disimpan; kolom lain diabaikan. Variasi jabatan seperti `BOD 3` otomatis dipetakan menjadi `BOD-3`. NIK disimpan sebagai teks, dan impor NIK yang sudah ada memperbarui data karyawan tersebut. File ini terpisah dari CSV tarif.

CSV tarif memakai header `jenis_perjalanan,jabatan,lokasi,uang_harian,uang_transportasi`. `jenis_perjalanan` diisi `Dalam Negeri` atau `Luar Negeri`. Isi satu baris untuk setiap kombinasi jenis perjalanan, jabatan, dan lokasi. Jika kombinasinya sama, impor berikutnya memperbarui tarif sebelumnya. Biaya online tetap Rp150.000 per hari untuk semua jabatan dan lokasi.

Database `sppd.db` menyimpan data karyawan dan semua tarif, termasuk uang diklat per provinsi. Database disertakan untuk mengisi PostgreSQL Vercel otomatis saat pertama kali aplikasi berjalan. Karena memuat NIK pegawai, repositori GitHub harus **Private** dan hanya dibagikan kepada orang yang berwenang. CSV terpisah tidak diperlukan untuk deployment.

Tarif uang diklat provinsi tersimpan langsung di tabel `training_allowances` dalam `sppd.db`. Tidak ada file atau menu upload uang diklat. Tarif sama untuk BOD-1 sampai BOD-5 dan dihitung per hari kegiatan offline; pada pelatihan gabungan, uang diklat hanya dihitung untuk hari offline.

Untuk jabatan BOD-1 sampai BOD-5, biaya transportasi dipilih pada formulir: Rp300.000, Rp400.000, Rp500.000, atau nominal manual. Pilihan ini berlaku untuk semua BOD tersebut dan dihitung satu kali per perjalanan dinas.

Tabel uang harian Dalam Negeri maupun Luar Negeri dapat diimpor terpisah dalam format matriks per daerah dengan kolom BOD-1 sampai BOD-5. Bila diimpor terpisah, tarif transportasi tidak dihitung sampai tarif transportasinya tersedia.

Tarif transportasi berdasarkan jabatan dapat diimpor untuk jabatan lain. BOD-1 sampai BOD-5 memilih nominal manual di formulir.

Biaya penginapan dimasukkan manual sebagai total untuk perjalanan. Kelas hotel otomatis mengikuti jabatan: Dewan Pengawas, Direksi, dan BOD-1 menggunakan hotel bintang 5; BOD-2 sampai BOD-5 menggunakan hotel bintang 4. Biaya yang dimasukkan ikut dijumlahkan dan ditampilkan pada hasil Excel.

Pilihan pelatihan gabungan menghitung uang harian dan uang diklat untuk hari offline, transportasi satu kali, serta biaya online Rp150.000 dikali hari online. Satu perhitungan dapat memuat beberapa peserta untuk perjalanan yang sama. Cari dan pilih karyawan untuk menambahkan peserta; biaya transportasi, penginapan, dan pendaftaran diisi per peserta. Ringkasan dan terbilang menjumlahkan semua peserta.

Tidak ada autentikasi. Siapa pun yang memiliki alamat situs dapat membuka aplikasi dan melihat data karyawan/tarif. Gunakan hanya jika akses publik ke data tersebut memang dikehendaki.

## Deploy ke Vercel dari GitHub

Vercel menjalankan `index.py` sebagai Flask Function. Berkas tampilan tetap berada di folder utama untuk memudahkan upload GitHub; `build.py` menyalinnya ke `public/` saat build Vercel. Tanpa konfigurasi PostgreSQL, API membaca data langsung dari `sppd.db` yang disertakan di repositori. Dalam mode ini, CSV tidak dapat diimpor langsung ke website; setelah memperbarui database lokal, unggah file `sppd.db` terbaru dan deploy ulang.

1. Unggah/push semua berkas proyek ke repositori GitHub **Private**, termasuk `sppd.db`, `index.py`, `build.py`, `pyproject.toml`, `requirements.txt`, `app.py`, `index.html`, `app.js`, dan `style.css`. Pastikan Root Directory proyek Vercel menunjuk ke folder yang sama.
2. Jalankan **Redeploy** di Vercel. `sppd.db` wajib ada di root proyek agar pencarian pegawai dan tarif dapat digunakan.
3. Mode tanpa PostgreSQL bersifat baca saja. Impor karyawan/tarif dari website tidak disimpan. Untuk mengubah data, perbarui `sppd.db` secara lokal, lalu unggah file database yang diperbarui ke GitHub dan deploy ulang.

PostgreSQL opsional: jika ingin impor CSV langsung dari website dan menyimpan perubahan permanen, buat database PostgreSQL lalu masukkan connection string sebagai `DATABASE_URL` di Vercel. Dalam mode ini, data awal dari `sppd.db` disalin otomatis satu kali.

### Jika aplikasi tidak dapat membaca database bawaan

- Pastikan file `sppd.db` ikut ada di root proyek GitHub dan ukuran file tidak melebihi batas unggah GitHub.
- Pastikan Root Directory proyek Vercel mengarah ke folder yang memuat `sppd.db`.
- Jalankan **Redeploy** setelah memperbarui file database.
- Jika pesan masih muncul, buka **Vercel → Project → Logs** untuk melihat penyebabnya.

Untuk uji lokal Flask/Vercel, instal paket dari `requirements.txt`, atur `DATABASE_URL` ke database uji, lalu gunakan `vercel dev`. `python3 app.py` tetap menjalankan mode lokal SQLite.

Untuk hosting container biasa yang menyediakan persistent volume, gunakan `Dockerfile` dan mount volume pada `/data`; database disimpan di `/data/sppd.db`.

### Kurs uang harian luar negeri

CSV uang harian Luar Negeri berisi nominal USD. Pilih Luar Negeri lalu isi kurs rupiah per 1 USD saat ini. Uang harian dikonversi menjadi rupiah sebelum perhitungan durasi dan potongan 75%. Kurs diisi manual dan dicantumkan pada Excel; transportasi, penginapan, serta pendaftaran tetap dalam rupiah.

### Rincian Excel

Unduhan Excel memuat satu baris per peserta, jumlah setiap komponen, total gabungan, dan terbilang. Laporan dicetak landscape; kolom biaya online hanya muncul untuk mode online atau gabungan.
