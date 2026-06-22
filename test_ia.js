const itemsJson = '[{"name":"Phulka","qty":1,"price":7},{"name":"Curd (50g)","qty":1,"price":12},{"name":"Rice (100g)","qty":1,"price":12},{"name":"Dal (200ml)","qty":1,"price":22},{"name":"Bhindi (Dry · 100ml)","qty":1,"price":22},{"name":"Kofta (Curry · 100ml)","qty":1,"price":22}]';
function ia_itemToCol(name) {
  const map = {
    'Chapati': 'Chapati', 'Without Oil Chapati': 'Without_Oil_Chapati',
    'Phulka': 'Phulka', 'Ghee Phulka': 'Ghee_Phulka',
    'Jowar Bhakri': 'Jowar_Bhakri', 'Bajra Bhakri': 'Bajra_Bhakri',
    'Dry Sabji Mini (100ml)': 'Dry_Sabji_Mini', 'Dry Sabji Full (250ml)': 'Dry_Sabji_Full',
    'Curry Sabji Mini (100ml)': 'Curry_Sabji_Mini', 'Curry Sabji Full (250ml)': 'Curry_Sabji_Full',
    'Dal (200ml)': 'Dal', 'Rice (100g)': 'Rice', 'Salad (40g)': 'Salad', 'Curd (50g)': 'Curd'
  };
  return map[name] || null;
}
function ia_orderCols(itemsJson) {
  const col = {};
  try { JSON.parse(itemsJson || '[]').forEach(function (it) {
    let c = it.col || ia_itemToCol(it.name);
    if (!c && it.name) {
      const n = it.name.toLowerCase();
      if (n.indexOf('dry') > -1 && n.indexOf('100ml') > -1) c = 'Dry_Sabji_Mini';
      else if (n.indexOf('dry') > -1 && n.indexOf('250ml') > -1) c = 'Dry_Sabji_Full';
      else if (n.indexOf('curry') > -1 && n.indexOf('100ml') > -1) c = 'Curry_Sabji_Mini';
      else if (n.indexOf('curry') > -1 && n.indexOf('250ml') > -1) c = 'Curry_Sabji_Full';
    }
    if (c) col[c] = (col[c] || 0) + (Number(it.qty) || 0);
  }); } catch (e) {}
  return col;
}
console.log(ia_orderCols(itemsJson));
