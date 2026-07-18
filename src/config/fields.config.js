window.SLF = window.SLF || {};

(function(){
  // kind: 'auto' = generated sequentially, no input · 'manual' = one value typed by the user, applied
  // to every output row · 'file' = pulled from a mapped source column · 'computed' = derived from
  // other fields · 'blank' = always empty, reserved for a downstream system to fill in later
  const FIELD_DEFS = [
    {key:'id', label:'ID', required:false, kind:'auto'},
    {key:'warehouse', label:'รหัสคลัง', required:false, kind:'manual'},
    {key:'company_code', label:'รหัสบริษัท', required:false, kind:'manual'},
    {key:'old_code', label:'รหัสเดิม', required:false, kind:'file'},
    {key:'inv_code', label:'รหัส INV', required:false, kind:'file'},
    {key:'item_name', label:'ชื่อรายการ', required:true, kind:'file'},
    {key:'unit', label:'หน่วยบรรจุ', required:false, kind:'file'},
    {key:'pack_size', label:'ขนาดบรรจุ', required:false, kind:'file'},
    {key:'lot', label:'Lot.', required:false, kind:'file'},
    {key:'expire', label:'Exp.', required:false, kind:'file'},
    {key:'qty', label:'คงเหลือ', required:true, kind:'file'},
    {key:'price_unit', label:'ราคาต่อหน่วย', required:false, kind:'file'},
    {key:'price_total', label:'ราคารวม', required:false, kind:'computed'},
    {key:'import_status', label:'สถานะการนำเข้า', required:false, kind:'blank'},
    {key:'donation_receipt_id', label:'ID ใบรับบริจาค', required:false, kind:'blank'},
    {key:'donation_item_id', label:'ID รายการที่รับบริจาค', required:false, kind:'blank'},
  ];

  // output-only fields rendered as plain, non-editable cells (no lot/exp/qty/name/code/unit/warehouse logic)
  const PASSTHROUGH_FIELDS = ['id','company_code','inv_code','pack_size','price_unit','price_total','import_status','donation_receipt_id','donation_item_id'];

  // fields that can be mapped from more than one source column (e.g. Lot1/Exp1/Qty1, Lot2/Exp2/Qty2 …)
  const MULTI_FIELDS = ['lot','expire','qty'];

  // a few FIELD_DEFS keys use a shorter internal row-object property name
  const FIELD_TO_ROWKEY = {old_code:'code', item_name:'name', expire:'expDate'};

  // Excel column widths per field, for export
  const FIELD_EXPORT_WIDTH = {
    id:10, warehouse:14, company_code:14, old_code:14, inv_code:14, item_name:32, unit:12, pack_size:12,
    lot:14, expire:14, qty:14, price_unit:14, price_total:14, import_status:16, donation_receipt_id:18, donation_item_id:22,
  };

  // row 1 of the export: fixed technical/system field names for the downstream import template
  const FIELD_TECH_NAME = {
    id:'uid', warehouse:'department_id', company_code:'stock_vendor_id', old_code:'item_code', inv_code:'item_id',
    item_name:'item_name', unit:'item_unit', pack_size:'item_unit_qty', lot:'item_lotno', expire:'item_exp',
    qty:'item_left_qty', price_unit:'item_unit_price', price_total:'item_price', import_status:'import_status',
    donation_receipt_id:'stock_dep_donation_id', donation_item_id:'stock_dep_donation_list_id',
  };

  const KEYWORDS = {
    old_code: ['itemcode','item_code','รหัสสินค้า','รหัสรายการ','sku','code','รหัสเดิม'],
    inv_code: ['รหัสinv','invcode','inv_code','รหัสไอเอ็นวี','itemid','item_id'],
    item_name: ['itemname','item_name','ชื่อสินค้า','ชื่อรายการ','name','ชื่อ'],
    unit: ['itemunit','item_unit','หน่วยนับ','หน่วยบรรจุ','unit','uom'],
    pack_size: ['ขนาดบรรจุ','packsize','itemunitqty','item_unit_qty'],
    lot: ['lot','lotno','lot_no','itemlotno','item_lotno','เลขล็อต','ล็อต','lotnumber','lot.'],
    expire: ['expiredate','expire_date','exp','itemexp','item_exp','วันหมดอายุ','expdate','exp.','exp date'],
    // 'stock' deliberately excluded — real files often have unrelated columns like stock_vendor_id /
    // stock_dep_donation_id whose names merely contain "stock"; matching that substring would wrongly
    // steal them into a multi-mapped field like qty
    qty: ['qty','balance','จำนวนคงเหลือ','คงเหลือ','itemleftqty','item_left_qty','onhand','จำนวน'],
    price_unit: ['unitprice','itemunitprice','item_unit_price','ราคาต่อหน่วย','priceperunit'],
  };

  SLF.config = SLF.config || {};
  SLF.config.FIELD_DEFS = FIELD_DEFS;
  SLF.config.PASSTHROUGH_FIELDS = PASSTHROUGH_FIELDS;
  SLF.config.MULTI_FIELDS = MULTI_FIELDS;
  SLF.config.FIELD_TO_ROWKEY = FIELD_TO_ROWKEY;
  SLF.config.FIELD_EXPORT_WIDTH = FIELD_EXPORT_WIDTH;
  SLF.config.FIELD_TECH_NAME = FIELD_TECH_NAME;
  SLF.config.KEYWORDS = KEYWORDS;
})();
