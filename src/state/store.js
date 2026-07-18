window.SLF = window.SLF || {};

(function(){
  function freshState(){
    return {
      step:1,
      fileName:'', fileSize:0, fileExt:'',
      workbook:null,
      sheetNames:[], selectedSheet:'',
      sheetRawRows:[], // array of arrays, full sheet
      headerRowIndex:0,
      headers:[],
      dataRows:[], // [{__rowNum, __key(header): value}]
      mapping:{warehouse:'',company_code:'',old_code:'',inv_code:'',item_name:'',unit:'',pack_size:'',lot:[],expire:[],qty:[],price_unit:''},
      extraCols:[], // headers user wants to carry through, unmapped
      settings:{
        lotSort:'source_order',
        displayMode:'repeat',
        mergeDuplicateLot:true,
        expiryWarnDays:180,
        noLotLabel:'ไม่ระบุ LOT'
      },
      issues:[], // {rowNum, field, type, message, severity}
      rowResolution:{}, // rowNum -> 'keep' | 'skip'
      rowResolutionReason:{}, // rowNum -> explanation shown on the validation screen
      grouped:[], // final computed rows
      filters:{search:'', onlyMulti:false, onlyNoLot:false, onlyNearExp:false, onlyExpired:false, onlyInvalidExp:false},
      page:1, pageSize:25,
    };
  }

  SLF.state = SLF.state || {};
  SLF.state.freshState = freshState;
  SLF.state.S = freshState(); // the single mutable app state, shared by every module
})();
