const fs = require('fs');

const mrAdditions = {
  "Kanda Poha": "कांपो",
  "Ghee Upma": "घीऊ",
  "Thalipeeth": "था",
  "Paneer Paratha": "पनपरा",
  "Methi Thepla": "मेथी",
  "Sabudana Khichdi": "साबु",
  "Methi Paratha": "मेपरा",
  "Methi Paratha (2 pieces)": "मेपरा",
  "Palak Paratha": "पालपरा",
  "Palak Paratha (2 peices)": "पालपरा",
  "Palak Paratha (2 pieces)": "पालपरा",
  "Aloo Paratha": "आलूपरा",
  "Ghee Sheera": "घीशि",
  "Sheera": "शिरा",
  "Tikhi Puri": "तिपु",
  "Tikhi Pudi": "तिपु",
  "5 x Tikhi Pudi with 100 ml coriander chutney": "तिपु",
  "Idli": "इड",
  "4 x Idli & 100ml Chutney": "इड",
  "4 x Idli and 100ml Chutney": "इड",
  "Dadpe Pohe": "दापो",
  "Masala Dosa": "मडो",
  "Sabudana Vada": "साव",
  "Batata Vada": "बव",
  "Misal Pav": "मिपा",
  "Coconut Chutney": "खोच",
  "Chutney": "खोच",
  "Upma": "उप",
  "Poha": "पो"
};

const enAdditions = {
  "Kanda Poha": "KP",
  "Ghee Upma": "GU",
  "Thalipeeth": "TP",
  "Paneer Paratha": "PP",
  "Methi Thepla": "MT",
  "Sabudana Khichdi": "SK",
  "Methi Paratha": "MP",
  "Methi Paratha (2 pieces)": "MP",
  "Palak Paratha": "PAP",
  "Palak Paratha (2 peices)": "PAP",
  "Palak Paratha (2 pieces)": "PAP",
  "Aloo Paratha": "AP",
  "Ghee Sheera": "GS",
  "Sheera": "SH",
  "Tikhi Puri": "TPU",
  "Tikhi Pudi": "TPD",
  "5 x Tikhi Pudi with 100 ml coriander chutney": "TPU",
  "Idli": "ID",
  "4 x Idli & 100ml Chutney": "ID",
  "4 x Idli and 100ml Chutney": "ID",
  "Dadpe Pohe": "DP",
  "Masala Dosa": "MD",
  "Sabudana Vada": "SV",
  "Batata Vada": "BV",
  "Misal Pav": "MPV",
  "Coconut Chutney": "CCT",
  "Chutney": "CCT",
  "Upma": "UP",
  "Poha": "PO"
};

// 1. Update 07_Labels_Auto.gs
let c07 = fs.readFileSync('07_Labels_Auto.gs', 'utf8');
const lblEnStart = c07.indexOf('var LBL_EN = {');
const lblEnEnd = c07.indexOf('};', lblEnStart) + 2;
const lblMrStart = c07.indexOf('var LBL_MR = {');
const lblMrEnd = c07.indexOf('};', lblMrStart) + 2;

const newLblEn = `var LBL_EN = {
  Chapati: "CH", Without_Oil_Chapati: "CH(O)", Phulka: "PH", Ghee_Phulka: "GPH",
  Jowar_Bhakri: "J", Bajra_Bhakri: "B",
  Dry_Sabji_Mini: "D100", Dry_Sabji_Full: "D250",
  Curry_Sabji_Mini: "C100", Curry_Sabji_Full: "C250",
  Dal: "DAL", Dal_Fry: "DF", Rice: "R", Salad: "S", Curd: "CU",
  "Kanda Poha": "KP", "Ghee Upma": "GU", "Thalipeeth": "TP",
  "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK",
  "Methi Paratha": "MP", "Methi Paratha (2 pieces)": "MP",
  "Palak Paratha": "PAP", "Palak Paratha (2 peices)": "PAP", "Palak Paratha (2 pieces)": "PAP",
  "Aloo Paratha": "AP", "Ghee Sheera": "GS", "Sheera": "SH",
  "Tikhi Puri": "TPU", "Tikhi Pudi": "TPD", "5 x Tikhi Pudi with 100 ml coriander chutney": "TPU",
  "Idli": "ID", "4 x Idli & 100ml Chutney": "ID", "4 x Idli and 100ml Chutney": "ID",
  "Dadpe Pohe": "DP", "Masala Dosa": "MD",
  "Sabudana Vada": "SV", "Batata Vada": "BV", "Misal Pav": "MPV",
  "Coconut Chutney": "CCT", "Chutney": "CCT",
  "Upma": "UP", "Poha": "PO"
};`;

const newLblMr = `var LBL_MR = {
  Chapati: "च", Without_Oil_Chapati: "च बिनतेल", Phulka: "फु", Ghee_Phulka: "घी फु",
  Jowar_Bhakri: "जो", Bajra_Bhakri: "बाज",
  Dry_Sabji_Mini: "सु १००", Dry_Sabji_Full: "सु २५०",
  Curry_Sabji_Mini: "र १००", Curry_Sabji_Full: "र २५०",
  Dal: "दाल", Dal_Fry: "डा.फ्रा.", Rice: "भात", Salad: "स", Curd: "दही",
  "Kanda Poha": "कांपो", "Ghee Upma": "घीऊ", "Thalipeeth": "था",
  "Paneer Paratha": "पनपरा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु",
  "Methi Paratha": "मेपरा", "Methi Paratha (2 pieces)": "मेपरा",
  "Palak Paratha": "पालपरा", "Palak Paratha (2 peices)": "पालपरा", "Palak Paratha (2 pieces)": "पालपरा",
  "Aloo Paratha": "आलूपरा", "Ghee Sheera": "घीशि", "Sheera": "शिरा",
  "Tikhi Puri": "तिपु", "Tikhi Pudi": "तिपु", "5 x Tikhi Pudi with 100 ml coriander chutney": "तिपु",
  "Idli": "इड", "4 x Idli & 100ml Chutney": "इड", "4 x Idli and 100ml Chutney": "इड",
  "Dadpe Pohe": "दापो", "Masala Dosa": "मडो",
  "Sabudana Vada": "साव", "Batata Vada": "बव", "Misal Pav": "मिपा",
  "Coconut Chutney": "खोच", "Chutney": "खोच",
  "Upma": "उप", "Poha": "पो"
};`;

c07 = c07.slice(0, lblEnStart) + newLblEn + c07.slice(lblEnEnd);
// re-calculate mr positions
const lblMrStart2 = c07.indexOf('var LBL_MR = {');
const lblMrEnd2 = c07.indexOf('};', lblMrStart2) + 2;
c07 = c07.slice(0, lblMrStart2) + newLblMr + c07.slice(lblMrEnd2);
fs.writeFileSync('07_Labels_Auto.gs', c07, 'utf8');
console.log('07_Labels_Auto.gs updated');

// 2. Update docs/Admin/kitchen.html
let kHtml = fs.readFileSync('docs/Admin/kitchen.html', 'utf8');
const kEnStart = kHtml.indexOf('const LABEL_EN = {');
const kEnEnd = kHtml.indexOf('};', kEnStart) + 2;
const newKEn = `const LABEL_EN = {
      Chapati: "CH", Without_Oil_Chapati: "CH(O)", Phulka: "PH", Ghee_Phulka: "GPH",
      Jowar_Bhakri: "J", Bajra_Bhakri: "B",
      Dry_Sabji_Mini: "D100", Dry_Sabji_Full: "D250",
      Curry_Sabji_Mini: "C100", Curry_Sabji_Full: "C250",
      Dal: "DAL", Dal_Fry: "DF", Rice: "R", Salad: "S", Curd: "CU",
      "Kanda Poha": "KP", "Ghee Upma": "GU", "Thalipeeth": "TP",
      "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK",
      "Methi Paratha": "MP", "Methi Paratha (2 pieces)": "MP",
      "Palak Paratha": "PAP", "Palak Paratha (2 peices)": "PAP", "Palak Paratha (2 pieces)": "PAP",
      "Aloo Paratha": "AP", "Ghee Sheera": "GS", "Sheera": "SH",
      "Tikhi Puri": "TPU", "Tikhi Pudi": "TPD", "5 x Tikhi Pudi with 100 ml coriander chutney": "TPU",
      "Idli": "ID", "4 x Idli & 100ml Chutney": "ID", "4 x Idli and 100ml Chutney": "ID",
      "Dadpe Pohe": "DP", "Masala Dosa": "MD",
      "Sabudana Vada": "SV", "Batata Vada": "BV", "Misal Pav": "MPV",
      "Coconut Chutney": "CCT", "Chutney": "CCT",
      "Upma": "UP", "Poha": "PO",
    };`;
kHtml = kHtml.slice(0, kEnStart) + newKEn + kHtml.slice(kEnEnd);

const kMrStart = kHtml.indexOf('const LABEL_MR = {');
const kMrEnd = kHtml.indexOf('};', kMrStart) + 2;
const newKMr = `const LABEL_MR = {
      Chapati: "च", Without_Oil_Chapati: "च बिनतेल", Phulka: "फु", Ghee_Phulka: "घी फु",
      Jowar_Bhakri: "जो", Bajra_Bhakri: "बाज",
      Dry_Sabji_Mini: "सु १००", Dry_Sabji_Full: "सु २५०",
      Curry_Sabji_Mini: "र १००", Curry_Sabji_Full: "र २५०",
      Dal: "दाल", Dal_Fry: "डा.फ्रा.", Rice: "भात", Salad: "स", Curd: "दही",
      "Kanda Poha": "कांपो", "Ghee Upma": "घीऊ", "Thalipeeth": "था",
      "Paneer Paratha": "पनपरा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु",
      "Methi Paratha": "मेपरा", "Methi Paratha (2 pieces)": "मेपरा",
      "Palak Paratha": "पालपरा", "Palak Paratha (2 peices)": "पालपरा", "Palak Paratha (2 pieces)": "पालपरा",
      "Aloo Paratha": "आलूपरा", "Ghee Sheera": "घीशि", "Sheera": "शिरा",
      "Tikhi Puri": "तिपु", "Tikhi Pudi": "तिपु", "5 x Tikhi Pudi with 100 ml coriander chutney": "तिपु",
      "Idli": "इड", "4 x Idli & 100ml Chutney": "इड", "4 x Idli and 100ml Chutney": "इड",
      "Dadpe Pohe": "दापो", "Masala Dosa": "मडो",
      "Sabudana Vada": "साव", "Batata Vada": "बव", "Misal Pav": "मिपा",
      "Coconut Chutney": "खोच", "Chutney": "खोच",
      "Upma": "उप", "Poha": "पो",
    };`;
kHtml = kHtml.slice(0, kMrStart) + newKMr + kHtml.slice(kMrEnd);

// Bump version in kitchen.html to v26.08.27.02
kHtml = kHtml.replace(/v26\.08\.27\.01/g, 'v26.08.27.02');
fs.writeFileSync('docs/Admin/kitchen.html', kHtml, 'utf8');
console.log('docs/Admin/kitchen.html updated');

// 3. Update docs/Admin/vault_admin.html
let vHtml = fs.readFileSync('docs/Admin/vault_admin.html', 'utf8');
// ABBREV_EN
const abEnStart = vHtml.indexOf('const ABBREV_EN = {');
const abEnEnd = vHtml.indexOf('};', abEnStart) + 2;
const newAbEn = `const ABBREV_EN = {
  "Chapati":"CH","Without_Oil_Chapati":"CH(O)","Phulka":"PH","Ghee_Phulka":"GPH",
  "Jowar_Bhakri":"J","Bajra_Bhakri":"B",
  "Dry_Sabji_Mini":"D100","Dry_Sabji_Full":"D250",
  "Curry_Sabji_Mini":"C100","Curry_Sabji_Full":"C250",
  "Dal":"DAL","Rice":"R","Salad":"S","Curd":"CU",
  "Kanda Poha":"KP","Ghee Upma":"GU","Thalipeeth":"TP",
  "Paneer Paratha":"PP","Methi Thepla":"MT","Sabudana Khichdi":"SK",
  "Methi Paratha":"MP","Palak Paratha":"PAP","Aloo Paratha":"AP",
  "Ghee Sheera":"GS","Sheera":"SH","Tikhi Puri":"TPU","Tikhi Pudi":"TPD",
  "Idli":"ID","Dadpe Pohe":"DP","Masala Dosa":"MD",
  "Sabudana Vada":"SV","Batata Vada":"BV","Misal Pav":"MPV",
  "Coconut Chutney":"CCT","Chutney":"CCT","Upma":"UP","Poha":"PO",
};`;
vHtml = vHtml.slice(0, abEnStart) + newAbEn + vHtml.slice(abEnEnd);

// ABBREV_MR
const abMrStart = vHtml.indexOf('const ABBREV_MR = {');
const abMrEnd = vHtml.indexOf('};', abMrStart) + 2;
const newAbMr = `const ABBREV_MR = {
  "Chapati":"च","Without_Oil_Chapati":"च बिनतेल","Phulka":"फु","Ghee_Phulka":"घी फु",
  "Jowar_Bhakri":"जो","Bajra_Bhakri":"बाज",
  "Dry_Sabji_Mini":"सु १००","Dry_Sabji_Full":"सु २५०",
  "Curry_Sabji_Mini":"र १००","Curry_Sabji_Full":"र २५०",
  "Dal":"दाल","Rice":"भात","Salad":"स","Curd":"दही",
  "Kanda Poha":"कांपो","Ghee Upma":"घीऊ","Thalipeeth":"था",
  "Paneer Paratha":"पनपरा","Methi Thepla":"मेथी","Sabudana Khichdi":"साबु",
  "Methi Paratha":"मेपरा","Palak Paratha":"पालपरा","Aloo Paratha":"आलूपरा",
  "Ghee Sheera":"घीशि","Sheera":"शिरा","Tikhi Puri":"तिपु","Tikhi Pudi":"तिपु",
  "Idli":"इड","Dadpe Pohe":"दापो","Masala Dosa":"मडो",
  "Sabudana Vada":"साव","Batata Vada":"बव","Misal Pav":"मिपा",
  "Coconut Chutney":"खोच","Chutney":"खोच","Upma":"उप","Poha":"पो",
};`;
vHtml = vHtml.slice(0, abMrStart) + newAbMr + vHtml.slice(abMrEnd);

// LABEL_EN in vault_admin
const vEnStart = vHtml.indexOf('const LABEL_EN = {');
const vEnEnd = vHtml.indexOf('};', vEnStart) + 2;
const newVEn = `const LABEL_EN = {
  Chapati:"CH", Without_Oil_Chapati:"CH(O)", Phulka:"PH", Ghee_Phulka:"GPH",
  Jowar_Bhakri:"J", Bajra_Bhakri:"B",
  Dry_Sabji_Mini:"D100", Dry_Sabji_Full:"D250",
  Curry_Sabji_Mini:"C100", Curry_Sabji_Full:"C250",
  Dal:"DAL", Rice:"R", Salad:"S", Curd:"CU",
  "Kanda Poha":"KP", "Ghee Upma":"GU", "Thalipeeth":"TP",
  "Paneer Paratha":"PP", "Methi Thepla":"MT", "Sabudana Khichdi":"SK",
  "Methi Paratha":"MP", "Palak Paratha":"PAP", "Aloo Paratha":"AP",
  "Ghee Sheera":"GS", "Sheera":"SH", "Tikhi Puri":"TPU", "Tikhi Pudi":"TPD",
  "Idli":"ID", "Dadpe Pohe":"DP", "Masala Dosa":"MD",
  "Sabudana Vada":"SV", "Batata Vada":"BV", "Misal Pav":"MPV",
  "Coconut Chutney":"CCT", "Chutney":"CCT", "Upma":"UP", "Poha":"PO",
};`;
vHtml = vHtml.slice(0, vEnStart) + newVEn + vHtml.slice(vEnEnd);

// LABEL_MR in vault_admin
const vMrStart = vHtml.indexOf('const LABEL_MR = {');
const vMrEnd = vHtml.indexOf('};', vMrStart) + 2;
const newVMr = `const LABEL_MR = {
  Chapati:"च", Without_Oil_Chapati:"च बिनतेल", Phulka:"फु", Ghee_Phulka:"घी फु",
  Jowar_Bhakri:"जो", Bajra_Bhakri:"बाज",
  Dry_Sabji_Mini:"सु १००", Dry_Sabji_Full:"सु २५०",
  Curry_Sabji_Mini:"र १००", Curry_Sabji_Full:"र २५०",
  Dal:"दाल", Rice:"भात", Salad:"स", Curd:"दही",
  "Kanda Poha":"कांपो", "Ghee Upma":"घीऊ", "Thalipeeth":"था",
  "Paneer Paratha":"पनपरा", "Methi Thepla":"मेथी", "Sabudana Khichdi":"साबु",
  "Methi Paratha":"मेपरा", "Palak Paratha":"पालपरा", "Aloo Paratha":"आलूपरा",
  "Ghee Sheera":"घीशि", "Sheera":"शिरा", "Tikhi Puri":"तिपु", "Tikhi Pudi":"तिपु",
  "Idli":"इड", "Dadpe Pohe":"दापो", "Masala Dosa":"मडो",
  "Sabudana Vada":"साव", "Batata Vada":"बव", "Misal Pav":"मिपा",
  "Coconut Chutney":"खोच", "Chutney":"खोच", "Upma":"उप", "Poha":"पो",
};`;
vHtml = vHtml.slice(0, vMrStart) + newVMr + vHtml.slice(vMrEnd);

// Bump version in vault_admin.html to v26.08.27.06
vHtml = vHtml.replace(/v26\.08\.27\.05/g, 'v26.08.27.06');
fs.writeFileSync('docs/Admin/vault_admin.html', vHtml, 'utf8');
console.log('docs/Admin/vault_admin.html updated');
