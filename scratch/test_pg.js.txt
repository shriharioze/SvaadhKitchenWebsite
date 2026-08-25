const cases = [
  "PG",
  "pg",
  "Amanora Park Town PG",
  "Amanora Park Town pg",
  "Some PG nearby",
  "PGE", // should be false
  "APG", // should be false
  "pgs", // should be false
];
cases.forEach(c => console.log(c, /\bpg\b/i.test(c)));
