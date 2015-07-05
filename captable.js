
/*
 * this is an object representing a captable. it gets used by the AA-SG-SPA.xml:
 *
 * <numbered_2_firstbold>Capitalization</numbered_2_firstbold>
 *
 * in future it will be something like data.capTable.getCurrentRound().by_security_type(...)
 * and it will know what the currentRound is from the name of the ...getActiveSheet()
 *
 * <numbered_3_para>Immediately prior to the Initial Closing, the fully diluted capital of the Company will consist of <?= digitCommas_(data.capTable.getRound("Bridge Round").by_security_type["Ordinary Shares"].TOTAL) ?> ordinary shares, <?= digitCommas_(data.capTable.getRound("Bridge Round").by_security_type["Class F Shares"].TOTAL) ?> Class F Redeemable Convertible Preference Shares both issued and reserved, and <?= digitCommas_(data.capTable.getRound("Bridge Round").by_security_type["Series AA Shares"].TOTAL) ?> YC-AA Preferred Shares. These shares shall have the rights, preferences, privileges and restrictions set forth in <xref to="articles_of_association" />.</numbered_3_para>
 * <numbered_3_para>The outstanding shares have been duly authorized and validly issued in compliance with applicable laws, and are fully paid and nonassessable.</numbered_3_para>
 * <numbered_3_para>The Company's ESOP consists of a total of <?= data.parties.esop[0].num_shares ?> shares, of which <?= digitCommas_(data.parties.esop[0]._orig_num_shares - data.capTable.getRound("Bridge Round").old_investors["ESOP"].shares) ?> have been issued and <?= digitCommas_(data.capTable.getRound("Bridge Round").old_investors["ESOP"].shares)?> remain reserved.</numbered_3_para>
 * 
 * the above hardcodes the name of the round into the XML. this is clearly undesirable.
 * we need a better way to relate the active round with the relevant terms spreadsheet.
 * 
 * How does this work?
 * First we go off and parse the cap table into a data structure
 * then we set up a bunch of methods which interpret the data structure as needed for the occasion.
 *
 */

function capTable_(sheet) {
  sheet = sheet || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  Logger.log("capTable_: running rounds() for sheet %s", sheet.getSheetName());
  this.rounds = parseCaptable(sheet);

  this.columnNames = function() {
	for (var cn = 0; cn < this.rounds.length; cn++) {
	  Logger.log("capTable.columnNames: column %s is named %s", cn, this.rounds[cn].name);
	}
  };

  // for each major column we compute the pre/post, old/new investor values.
  // we want to know:
  // - who the existing shareholders are before the round:
  //   old_investors: { investorName: { shares, money, percentage } }
  // - how many total shares exist at the start of the round:
  //   shares_pre
  // - how many shares of different types exist at the start of the round:
  //   by_security_type = { "Class F Shares" : { "Investor Name" : nnn, "TOTAL" : mmm }, ... }
  //   
  // - we keep a running total to carry forward from round to round
  var totals = { shares_pre: 0,
				 money_pre: 0,
				 all_investors: {},
				 by_security_type: {},
			   };

  for (var cn = 0; cn < this.rounds.length; cn++) {
	var round = this.rounds[cn];
	Logger.log("capTable.new(): embroidering column %s", round.name);

	// if only we had some sort of native deepcopy method... oh well.
	round.old_investors = {};
	for (var ai in totals.all_investors) {
	  round.old_investors[ai] = {};
	  for (var attr in totals.all_investors[ai]) {
		round.old_investors[ai][attr] = totals.all_investors[ai][attr];
	  }
	}
	Logger.log("capTable.new(): %s.old_investors = %s", round.name, round.old_investors);

	totals.by_security_type[round.security_type] = totals.by_security_type[round.security_type] || {};
	
	round.shares_pre = totals.shares_pre;

	var new_shares = 0, new_money = 0;
	for (var ni in round.new_investors) {
	  if (round.new_investors[ni].shares == undefined) continue;
	  new_shares += round.new_investors[ni].shares;
	  new_money  += round.new_investors[ni].money;
	  totals.by_security_type[round.security_type][ni] = totals.by_security_type[round.security_type][ni] || 0; // js lacks autovivication, sigh
	  totals.by_security_type[round.security_type][ni] += round.new_investors[ni].shares;
	  for (var attr in round.new_investors[ni]) {
		if (round.new_investors[ni] == undefined) { continue } // sometimes an old investor doesn't re-up, so they're excused from action.
		if (attr == "percentage") { continue } // percentages don't need to add
		if (round.new_investors[ni][attr] == undefined) { continue } // money and shares do, but we don't always get new ones of those.
		totals.all_investors[ni] = totals.all_investors[ni] || {};
		totals.all_investors[ni][attr] = totals.all_investors[ni][attr] || 0;
		totals.all_investors[ni][attr] += round.new_investors[ni][attr];
	  }
	}

	round.by_security_type = {};
	for (var bst in totals.by_security_type) {
	  round.by_security_type[bst] = { TOTAL: 0};
	  for (var inv in totals.by_security_type[bst]) {
		round.by_security_type[bst][inv]   = totals.by_security_type[bst][inv];
		round.by_security_type[bst].TOTAL += totals.by_security_type[bst][inv];
	  }
	}
	Logger.log("capTable: round.by_security_type = %s", JSON.stringify(round.by_security_type));

	if (round.new_investors["ESOP"] != undefined && round.new_investors["ESOP"].shares) {
	  Logger.log("capTable: round %s has a new_investor ESOP with value %s", round.name, round.new_investors["ESOP"]);
	  round.ESOP = round.ESOP || new ESOP_(round.security_type, 0);
	  Logger.log("capTable: establishing ESOP object for round %s", round.name);
	  var seen_ESOP_investor = false;
	  for (var oi in round.ordered_investors) {
		var inv = round.ordered_investors[oi];
		Logger.log("capTable: considering investor %s", inv);
		if (inv == "ESOP") { seen_ESOP_investor = true;
							 round.ESOP.createHolder(inv);
							 round.ESOP.holderGains(inv, round.new_investors[inv].shares);
							 continue;
						   }
		else if ( seen_ESOP_investor ) {
		  round.ESOP.createHolder(inv);
		  round.ESOP.holderGains(inv, round.new_investors[inv].shares);
		}
		else {
		  Logger.log("capTable: in constructing the ESOP object for round %s we ignore any rows above the ESOP line -- %s", round.name, inv);
		}
		// TODO: in future add a running total, similar to the rest of how we manage shares by type above.
		// if we don't do this, then multiple columns which deal with ESOP will not do the right thing.
	  }
	  Logger.log("capTable: created an ESOP object for round %s: %s", round.name, JSON.stringify(round.ESOP.holders));
	}

	
//	Logger.log("capTable.new(): we calculate that round \"%s\" has %s new shares", round.name, new_shares);
//	Logger.log("capTable.new(): the sheet says that we should have %s new shares", round.amount_raised.shares);
	// TODO: we should probably raise a stink if those values are not the same.
//	Logger.log("capTable.new(): we calculate that round \"%s\" has %s new money", round.name, new_money);
//	Logger.log("capTable.new(): the sheet says that we should have %s new money", round.amount_raised.money);
  }

//  Logger.log("capTable.new(): embroidered rounds to %s", this.rounds);

  this.getRound = function(roundName) {
	var toreturn;
	for (var ri = 0; ri < this.rounds.length; ri++) {
	  if (this.rounds[ri].name == roundName) {
		toreturn = this.rounds[ri];
		break;
	  }
	}
	return toreturn;
  };

  this.byInvestorName = {}; // investorName to Investor object

  // what does an Investor object look like?
  // { name: someName,
  //   rounds: [ { name: roundName,
  //               price_per_share: whatever,
  //               shares: whatever,
  //               money: whatever,
  //               percentage: whatever,
  //             }, ...
  //           ]
  
  // all the investors
  this.allInvestors = function() {
	var toreturn = []; // ordered list of investor objects

	// walk through each round and add the investor to toreturn
	for (var cn = 0; cn < this.rounds.length; cn++) {
	  var round = this.rounds[cn];
	  if (round.name == "TOTAL") { continue; }
	  var new_investors = round.new_investors;

	  for (var investorName in new_investors) {
		var investorInRound = new_investors[investorName];
		var investor;
		if (this.byInvestorName[investorName] == undefined) {
		  investor = this.byInvestorName[investorName] = { name: investorName };
		  toreturn.push(investor);
		} else {
		  investor = this.byInvestorName[investorName];
		}

		if (investor.rounds == undefined) {
		  investor.rounds = [];
		}
		investor.rounds.push({name:            round.name,
							  price_per_share: round.price_per_share.shares,
							  shares:          investorInRound.shares,
							  money:           investorInRound.money,
							  percentage:      investorInRound.percentage,
							 });
	  }
	}
	Logger.log("i have built allInvestors: %s", JSON.stringify(toreturn));
	return toreturn;
  };
  
}

// parseCaptable
// previously known as "Show Me The Money!"

// returns an array (all the rounds) of hashes (each round) with hashes (each investor).
// ECMAscript 6 specifies that hashes maintain key ordering, so i did that at first,
// but some random guy on the Internet said that hashes are unordered, so I used an array lor.
// [
//  {
//    security_type: string,
//    approximate_date: Date,
//    pre_money: NNN,
//    price_per_share: P,
//    discount: D,
//    new_investors:
//      { investorName: {
//           shares: N,
//           money:  D,
//           percentage: P,
//        },
//        investorName: {
//           shares: N,
//           money:  D,
//           percentage: P,
//        },
//      },
//    amount_raised: NNN,
//    shares_post: NNN,
//    post_money: NNN,
//  },
//  ... // another round
//  ... // another round
//  { name: "TOTAL", ... }
// ]   
function parseCaptable(sheet) {
  var captableRounds = [];

  sheet = sheet || SpreadsheetApp.getActiveSheet();
  
  Logger.log("parseCaptable: running on sheet %s", sheet.getSheetName());
  var rows = sheet.getDataRange();
  var numRows  = rows.getNumRows();
  var values   = rows.getValues();
  var formulas = rows.getFormulas();
  var formats  = rows.getNumberFormats();

  var section = null;
  var majorToRound = {};
  var majorByName = {}; // round_name: column_index
  var majorByNum  = {}; // column_index: round_name
  var minorByName = {}; // money / shares / percentage is in column N
  var minorByNum  = {}; // column N is a money column, or whatever

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];

    if (row[0] == "CAP TABLE") { section = row[0]; continue }

    if (section == "CAP TABLE") {
      // INITIALIZE A NEW ROUND
	  // each major column is on a 3-column repeat.
	  var asvar0 = asvar_(row[0]);
	  // asvar_("my Cool String (draft)") is "my_cool_string_draft".
	  // other people might do myCoolStringDraft, but I don't like camelCase.
      if (row[0] == "round name") {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/roundname: looking at row[%s], which is %s",
//                                                          j,        row[j]);
          majorByName[row[j]] =     j;
          majorByNum     [j]  = row[j];
		  majorToRound[row[j]]= captableRounds.length;
          
          captableRounds.push( { name: row[j], new_investors: {}, ordered_investors: [] } ); // we haz a new round!
//          Logger.log("captable/roundname: I have learned about a new round, called %s", row[j]);
        }
      }
	  // ABSORB THE MAJOR-COLUMN ROUND ATTRIBUTES
      else if (row[0] == "security type" ||
			   row[0] == "approximate date"
      ) {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/securitytype: looking at row[%s], which is %s",
//                                                             j,        row[j]);
          // if i'm in column j, what round am i in?
          var myRound = captableRounds[majorToRound[majorByNum[j]]];
          myRound[asvar_(row[0])] = row[j];
        }
      }
	  // LEARN ABOUT THE MINOR COLUMN ATTRIBUTES
      else if (row[0] == "break it down for me") {
        // each minor column has its own thang, so that later we will have
        // myRound.pre_money.money = x, myRound.pre_money.shares = y, myRound.pre_money.percentage = z
        // myRound[investorName].money = x, myRound[investorName].shares = y, myRound[investorName].percentage = z
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/breakdown: looking at row[%s], which is %s",
//                                                          j,        row[j]);
          var myRound; // we might be offset from a major column boundary so keep looking left until we find a major column.

          for (var k = 0; k < j; k++) {
            if (! captableRounds[majorToRound[majorByNum[j-k]]]) { continue }
            myRound = captableRounds[majorToRound[majorByNum[j-k]]];
//            Logger.log("captable/breakdown: found major column for %s: it is %s", row[j], myRound.name);
            break;
          }

		  var asvar = asvar_(row[j]);
		  
          minorByName[myRound.name + asvar] =     j;
          minorByNum [j]  = { round: myRound, minor: asvar };
          
//          Logger.log("captable/breakdown: we have learned that if we encounter a thingy in column %s it belongs to round (%s) attribute (%s)",
//                                                                                                   j,                    myRound.name, minorByNum[j].minor);
        }
      }
	  // LEARN ABOUT THE ROUND MINOR ATTRIBUTES
      else if (row[0] == "pre-money" ||
          row[0] == "price per share" ||
          row[0] == "discount" ||
          row[0] == "amount raised" ||
          row[0] == "post"
      ) {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
//          Logger.log("captable/%s: looking at row[%s], which is %s",
//                               asvar0,            j,        row[j]);
//          Logger.log("captable/%s: if we're able to pull a rabbit out of the hat where we stashed it, round is %s and attribute is %s",
//                               asvar0,                                                      minorByNum[j].round.name, minorByNum[j].minor);
          // learn something useful. er. where do we put the value?
          var myRound = minorByNum[j].round;
		  myRound[asvar0] = myRound[asvar0] || {};
		  // for rows "price per share" and "discount" we save it one layer deeper than we actually need to -- so when you pull it out, dereference the minor col.
          myRound[asvar0][minorByNum[j].minor] = row[j];
        }
      }
	  // WE MUST BE DEALING WITH AN INVESTOR!
      else {
        for (var j = 1; j<= row.length; j++) {
          if (! row[j]) { continue }
          Logger.log("captable/investor: the investor is %s, and we're looking at row[%s], which is a %s %s",
                     row[0],                           j,    minorByNum[j].minor,    row[j]);
          // learn something useful. er. where do we put the value?
          var myRound = minorByNum[j].round;
		  if (myRound.new_investors[row[0]] == undefined) {
			myRound.ordered_investors.push(row[0]);
			myRound.new_investors[row[0]] = {};
		  }
          myRound.new_investors[row[0]][minorByNum[j].minor] = row[j];
          myRound.new_investors[row[0]]["_orig_"+minorByNum[j].minor] = row[j];
		  Logger.log("learned that %s.%s.%s = %s (%s)", myRound.name, row[0], minorByNum[j].minor, row[j], row[j].constructor.name);
        }
      }
    }
  }
//  Logger.log("we have learned about the cap table rounds: %s", captableRounds);
  return captableRounds;
}








function reset(){
  var cap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Cap Table");
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(cap);
  parseCaptable(cap);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet10");
  sheet.clear();
}

function createCaptable(captableRounds){
  reset();
  var capTable = parseCaptable();
  
//Find a blank sheet
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var sheet;
  for (var i = 0; i < sheets.length ; i++ ) {
//    Logger.log(sheets[i].getDataRange().getWidth());
    if (sheets[i].getDataRange().isBlank()){
      sheet = sheets[i]
      break;
    }
  };
  
  //If no blank sheet, create a new one
  if (!sheet){
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet();
  }
  
  //create sheet title: CAP TABLE
  var cell = sheet.getRange(1, 1);
  cell.setValue("CAP TABLE");
  
  //hardcode catagories
  var catagories = ["round name", 
                    "security type", 
                    "approximate date", 
                    "break it down for me", 
                    "pre-money", 
                    "price per share", 
                    "discount", 
                    "amount raised", 
                    "post"];
  
  var roundArray = getRoundArray(capTable);
  
  for (var i = 2; i< catagories.length + 2; i++){
    cell = sheet.getRange(i, 1);
    cell.setValue(catagories[i-2]);
    var roundNumber = 0;
    
    Logger.log(roundArray);
    var j = 2;
    Logger.log("roundArray.length is " + roundArray.length)
    while (roundNumber < roundArray.length){
      var dataCell = sheet.getRange(i, j);
      var category = cell.getValue();
      
      if (category == "break it down for me"){
        dataCell = sheet.getRange(i, j, 1, 3);
        dataCell.setValues([['money', 'shares', 'percentage']]);
      }
      if (category == "round name"){
        category = "name";
      }
      Logger.log("round number is " + roundNumber);
      Logger.log("category is " + category);
      var dataCellValue = getCategoryData(capTable, roundNumber, category);
      
      if (!dataCellValue){}
      else if (dataCellValue.constructor == Object){
        var shares = getSharesValue(capTable, roundNumber, category) || "";
        var money = getMoneyValue(capTable, roundNumber, category) || "";
        var percentage = getPercentageValue(capTable, roundNumber, category) || "";
        dataCell = sheet.getRange(i, j, 1, 3);
        dataCell.setValues([[money, shares, percentage]]);
      }
      else{
        Logger.log("dataCell Value is " + dataCellValue);
        if (dataCellValue){
          dataCell.setValue(dataCellValue);
        }
      }
      j += 3;
      roundNumber++;
    }
  }
  
  
  
  var sheetResult = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet10");
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheetResult);


}

//get functions for each catagory

//returns an array, given round number, gives round name
function getRoundArray(capTable){
  var roundToNumber = []
  //key starts at 0
  for (key in capTable){
    roundToNumber[key] = capTable[key]["name"];
  }
  return roundToNumber
}

//returns the round name, given round number
function getRoundName(capTable, roundNumber){
  var round = getRoundArray(capTable);
  var roundName = round[roundNumber];
  return roundName;
}

//returns a number, given round name, gives round number
function getRoundNumber(capTable, roundName){
  var round = getRoundArray(capTable);
  var roundNumber = round.indexOf(roundName);
  return roundNumber;
}

function getCategoryData(capTable, round, category){
  var key = asvar_(category);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key];
  }
  else{
    return capTable[round][key]
  }
}

function getMoneyValue(capTable, round, catagory){
  var key = asvar_(catagory);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key]["money"];
  }
  else{
    return capTable[round][key]["money"];
  }
}

function getSharesValue(capTable, round, catagory){
    var key = asvar_(catagory);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key]["shares"];
  }
  else{
    return capTable[round][key]["shares"];
  }
}

function getPercentageValue(capTable, round, catagory){
    var key = asvar_(catagory);
  if (typeof round == "string"){
    var roundNum = getRoundNumber(capTable, round);
    return capTable[roundNum][key]["percentage"];
  }
  else{
    return capTable[round][key]["percentage"];
  }
}



