window.SLF = window.SLF || {};

(function(){
  const STEP_LABELS = [
    'อัปโหลดไฟล์','เลือก Sheet / หัวตาราง','จับคู่คอลัมน์','ตั้งค่าการจัดเรียง','ตรวจสอบข้อมูล','ดูตัวอย่างผลลัพธ์','ส่งออก Excel'
  ];

  const LOT_SORT_OPTS = [
    {v:'source_order', t:'ตามลำดับเดิมในไฟล์ (แนะนำ)', d:'คงลำดับ LOT ตามที่ปรากฏในไฟล์ต้นฉบับ (เช่น Lot No.1, 2, 3)'},
    {v:'lot_asc', t:'เรียงตามเลข LOT', d:'เรียงจาก LOT ตามลำดับตัวอักษร/ตัวเลข'},
    {v:'expire_asc', t:'วันหมดอายุ ใกล้ → ไกล', d:'LOT ที่ใกล้หมดอายุที่สุดขึ้นก่อน'},
    {v:'expire_desc', t:'วันหมดอายุ ไกล → ใกล้', d:'LOT ที่หมดอายุช้าที่สุดขึ้นก่อน'},
    {v:'qty_desc', t:'จำนวนคงเหลือ มาก → น้อย', d:'เรียงตามจำนวนคงเหลือของแต่ละ LOT'},
  ];

  const DISPLAY_OPTS = [
    {v:'sparse', t:'แบบที่ 2 — แสดงชื่อสินค้าแถวแรกเท่านั้น (แนะนำ)', d:'แถว LOT ถัดไปเว้นข้อมูลสินค้าหลักที่ซ้ำกัน'},
    {v:'repeat', t:'แบบที่ 1 — แสดงข้อมูลสินค้าซ้ำทุกแถว', d:'ทุกแถวแสดงรหัส/ชื่อสินค้าครบถ้วน'},
  ];

  SLF.config = SLF.config || {};
  SLF.config.STEP_LABELS = STEP_LABELS;
  SLF.config.LOT_SORT_OPTS = LOT_SORT_OPTS;
  SLF.config.DISPLAY_OPTS = DISPLAY_OPTS;
})();
