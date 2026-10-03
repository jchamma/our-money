<div dir="rtl">

# התקנה: "הכסף שלנו"

**כמה זמן:** 20 דקות.
**מה צריך:** מחשב, טלפון, חשבון RiseUp, וחשבון GitHub (חינם, אפשר לפתוח תוך כדי ההתקנה).

הכניסה לאפליקציה היא עם Face ID או טביעת אצבע.
רוצים כניסה עם חשבון Google במקום? [המדריך ל־Google](setup-google.md).

---

## שלב 1: מתקינים Node.js

1. נכנסים ל־**https://nodejs.org/en/download**
2. מורידים ומתקינים, עם כל ברירות המחדל.
3. **ב־Mac בלבד:** נכנסים ל־**https://cli.github.com**, לוחצים **Download for Mac** ומתקינים, עם כל ברירות המחדל.

✅ **סיימתם את שלב 1.**

---

## שלב 2: מורידים את האפליקציה

**ב־Windows:**
1. מורידים מכאן: **https://github.com/jchamma/our-money/archive/refs/heads/master.zip**
2. קליק ימני על הקובץ שירד ← **Extract All**.
3. מוחקים את הכתובת שבחלון וכותבים במקומה: **`C:\`**
4. לוחצים **Extract**.

✅ **נוצרה התיקייה `C:\our-money-master`.**

**ב־Mac:**
1. מורידים מכאן: **https://github.com/jchamma/our-money/archive/refs/heads/master.zip**
2. לוחצים פעמיים על הקובץ שירד.

✅ **נוצרה התיקייה `our-money-master` בתוך Downloads.**

---

## שלב 3: מקבלים קוד מ־RiseUp

1. נכנסים ל־**https://input.riseup.co.il/developer/tokens**
2. לוחצים **צור טוקן חדש**.
3. נותנים לו שם, למשל `OurMoney`.
4. מסמנים **`budget:read`** ויוצרים.
5. מעתיקים את הקוד **מיד**: הוא מופיע רק פעם אחת.

✅ **סיימתם את שלב 3.**

---

## שלב 4: מתקינים

1. פותחים **Terminal**.
2. מדביקים את השורה הזו ולוחצים **Enter**:

   ב־Windows:
   ```
   cd C:\our-money-master
   ```
   ב־Mac:
   ```
   cd ~/Downloads/our-money-master
   ```

3. מדביקים את השורה הזו ולוחצים **Enter**:

   ```
   node scripts/setup.mjs
   ```

4. עונים על השאלות. **בכל שאלה לוחצים Enter**, חוץ מאלה:

| כשרואים | עושים |
|---|---|
| נפתח דפדפן של **Cloudflare** | נרשמים (חינם, בלי כרטיס אשראי) או נכנסים, ולוחצים **Allow** |
| `How many people` | **Enter** לזוג, או `1` אם זה רק אתם |
| `RiseUp token` | מדביקים את הקוד משלב 3 ולוחצים **Enter** (לא רואים כלום על המסך, וזה בסדר) |
| `continue?` | `y` ואז **Enter** |
| `workers.dev subdomain` | שם קצר באנגלית, למשל שם המשפחה, ואז **Enter** |
| `Turn on automatic updates` | **Enter** |
| חלון של Windows שואל אם לאשר שינויים | **Yes** (זו התקנה של GitHub CLI) |
| `Authenticate Git` | **Enter** |
| `Press Enter to open github.com` | מעתיקים את הקוד בן 8 התווים שמופיע שורה אחת מעל, ולוחצים **Enter**. בדפדפן שנפתח: נרשמים ל־GitHub (חינם) או נכנסים, מדביקים את הקוד ולוחצים **Authorize** |
| `Cloudflare API token` | לוחצים על הקישור הארוך שמופיע מעל, עם **Ctrl** (ב־Mac: **Cmd**). בדף שנפתח: **Continue to summary** ← **Create Token** ← **Copy**. חוזרים ל־Terminal, מדביקים ולוחצים **Enter** (לא רואים כלום על המסך, וזה בסדר) |
| `Checking it works` | מחכים 2–4 דקות, עד שמופיע `Automatic updates are on` |

✅ **סיימתם את שלב 4 כשמופיעה המילה `Done.`**

מעליה יש שני קישורים:
- **Person 1:** בשבילכם.
- **Person 2:** בשביל בן או בת הזוג.

---

## שלב 5: פותחים בטלפון

כל אחד בטלפון שלו, עם הקישור שלו:

1. שולחים את הקישור לטלפון (למשל בוואטסאפ לעצמכם) ופותחים אותו.
2. כותבים את השם שלכם.
3. לוחצים **הפעלת כניסה ביומטרית** ומאשרים עם Face ID או טביעת אצבע.
4. מוסיפים למסך הבית:
   - **iPhone:** כפתור השיתוף ← **הוספה למסך הבית**
   - **Android:** ⋮ ← **התקנת אפליקציה**

🎉 **זהו! האפליקציה מוכנה.**

---

## פעם בחודש

האפליקציה תבקש **לחדש**. עושים שוב את שלב 3 ומדביקים את הקוד באפליקציה.

---

## הקישור בטלפון לא עובד

1. פותחים **Terminal**.
2. מדביקים את שורת ה־`cd` משלב 4 ולוחצים **Enter**.
3. מדביקים את השורה הזו ולוחצים **Enter**:

   ```
   node scripts/add-person.mjs
   ```

4. פותחים בטלפון את הקישור החדש, כמו בשלב 5.

---

## טלפון חדש

1. פותחים **Terminal**.
2. מדביקים את שורת ה־`cd` משלב 4 ולוחצים **Enter**.
3. מדביקים את השורה הזו ולוחצים **Enter**, ובוחרים את מי שקיבל טלפון חדש:

   ```
   node scripts/remove-person.mjs
   ```

4. מדביקים את השורה הזו ולוחצים **Enter**:

   ```
   node scripts/add-person.mjs
   ```

5. פותחים בטלפון החדש את הקישור החדש, כמו בשלב 5.

**לא מוחקים את התיקייה `our-money-master`.** צריך אותה לטלפון חדש.

---

## עדכונים

גרסאות חדשות (תיקונים ושיפורים) מותקנות לבד, תוך 3 שעות מרגע שהן יוצאות. לא צריך לעשות כלום.
העדכונים עוברים דרך מאגר פרטי בחשבון ה־GitHub שלכם, `our-money-updates`. הנתונים שלכם לא עוברים ל־GitHub.

---

## התקנתם לפני אוקטובר 2026?

העדכונים האוטומטיים עוד לא פעילים אצלכם. מפעילים אותם פעם אחת:

**ב־Windows:**
1. מורידים מכאן: **https://github.com/jchamma/our-money/archive/refs/heads/master.zip**
2. קליק ימני על הקובץ שירד ← **Extract All**, כותבים **`C:\`** ולוחצים **Extract**.
3. כש־Windows שואל אם להחליף קבצים: **Replace the files in the destination**.

**ב־Mac:**
1. ב־Downloads משנים את שם התיקייה `our-money-master` ל־`our-money-old`.
2. מורידים מכאן: **https://github.com/jchamma/our-money/archive/refs/heads/master.zip** ולוחצים פעמיים על הקובץ שירד.
3. פותחים **Terminal**, מדביקים את השורות האלה ולוחצים **Enter**:

   ```
   cd ~/Downloads
   cp our-money-old/wrangler.jsonc our-money-master/
   ```

**ואז, בשניהם:**
1. פותחים **Terminal**, מדביקים את שורת ה־`cd` משלב 4 ולוחצים **Enter**.
2. מדביקים את השורה הזו ולוחצים **Enter**:

   ```
   node scripts/update.mjs
   ```

3. עונים כמו בטבלה של שלב 4, מהשורה `Turn on automatic updates`.

✅ **סיימתם כשמופיע `Automatic updates are on`.** מעכשיו לא צריך לעשות את זה שוב.

---

## משהו לא עבד?

| מה קרה | מה עושים |
|---|---|
| `Couldn't turn on automatic updates` / `The first update didn't finish` | האפליקציה עובדת. פותחים **Terminal**, מדביקים את שורת ה־`cd` משלב 4, ואז `node scripts/auto-update.mjs` ו־**Enter** |
| `RiseUp didn't accept this token` | עושים שוב את שלב 3 ומדביקים את הקוד החדש |
| `node` לא מוכר | עושים שוב את שלב 1, סוגרים את ה־Terminal ופותחים מחדש |
| `cannot find path` / `No such file` | עושים שוב את שלב 2 בדיוק כמו שכתוב |

</div>
