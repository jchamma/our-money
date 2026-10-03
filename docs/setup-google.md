<div dir="rtl">

# התקנה עם כניסה דרך Google: "הכסף שלנו"

**כמה זמן:** 30 דקות.
**מה צריך:** מחשב, טלפון, חשבון RiseUp, וחשבון Gmail לכל אחד מכם, וחשבון GitHub (חינם, אפשר לפתוח תוך כדי ההתקנה).

הכניסה לאפליקציה היא עם חשבון Google. רק כתובות ה־Gmail שתכתבו יוכלו להיכנס.

**טיפ:** כניסה עם Face ID פשוטה יותר וקצרה ב־10 דקות: [המדריך ל־Face ID](setup-passkeys.md).

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
| `How will you log in?` | `2` ואז **Enter** |
| `How many people` | **Enter** לזוג, או `1` אם זה רק אתם |
| `Person 1: Google account` | כתובת ה־Gmail שלכם, ואז **Enter** |
| `Person 2: Google account` | כתובת ה־Gmail של בן או בת הזוג, ואז **Enter** |
| `RiseUp token` | מדביקים את הקוד משלב 3 ולוחצים **Enter** (לא רואים כלום על המסך, וזה בסדר) |
| `continue?` | `y` ואז **Enter** |
| `workers.dev subdomain` | שם קצר באנגלית, למשל שם המשפחה, ואז **Enter** |

ההתקנה עוצרת ומראה שתי כתובות:

```
Authorized JavaScript origin:  https://...
Authorized redirect URI:       https://.../auth/google/callback
```

**לא סוגרים את ה־Terminal.** עוברים לשלב 5.

---

## שלב 5: מחברים את Google

1. נכנסים ל־**https://console.cloud.google.com/projectcreate**
2. **Project name:** `our-money` ← **Create**.
3. נכנסים ל־**https://console.cloud.google.com/auth/overview** ולוחצים **Get started**.
4. ממלאים:
   - **App name:** `הכסף שלנו`
   - **User support email:** ה־Gmail שלכם
   - **Audience:** **External**
   - **Contact information:** ה־Gmail שלכם
5. מסמנים הסכמה ולוחצים **Create**.
6. נכנסים ל־**https://console.cloud.google.com/auth/audience**
7. תחת **Test users** לוחצים **Add users**, מוסיפים את שתי כתובות ה־Gmail, ולוחצים **Save**.
8. נכנסים ל־**https://console.cloud.google.com/auth/clients** ולוחצים **Create client**.
9. ממלאים:
   - **Application type:** **Web application**
   - **Authorized JavaScript origins** ← **Add URI**: מדביקים את הכתובת הראשונה מה־Terminal
   - **Authorized redirect URIs** ← **Add URI**: מדביקים את הכתובת השנייה מה־Terminal
10. לוחצים **Create**.
11. נפתח חלון עם **Client ID** ו־**Client secret**. משאירים אותו פתוח.

✅ **סיימתם את שלב 5.**

---

## שלב 6: מסיימים את ההתקנה

חוזרים ל־Terminal:

| כשרואים | עושים |
|---|---|
| `Client ID` | מעתיקים את ה־**Client ID** מ־Google, מדביקים, ואז **Enter** |
| `Client secret` | מעתיקים את ה־**Client secret** מ־Google, מדביקים, ואז **Enter** (לא רואים כלום על המסך, וזה בסדר) |
| `Turn on automatic updates` | **Enter** |
| חלון של Windows שואל אם לאשר שינויים | **Yes** (זו התקנה של GitHub CLI) |
| `Authenticate Git` | **Enter** |
| `Press Enter to open github.com` | מעתיקים את הקוד בן 8 התווים שמופיע שורה אחת מעל, ולוחצים **Enter**. בדפדפן שנפתח: נרשמים ל־GitHub (חינם) או נכנסים, מדביקים את הקוד ולוחצים **Authorize** |
| `Cloudflare API token` | לוחצים על הקישור הארוך שמופיע מעל, עם **Ctrl** (ב־Mac: **Cmd**). בדף שנפתח: **Continue to summary** ← **Create Token** ← **Copy**. חוזרים ל־Terminal, מדביקים ולוחצים **Enter** (לא רואים כלום על המסך, וזה בסדר) |
| `Checking it works` | מחכים 2–4 דקות, עד שמופיע `Automatic updates are on` |

✅ **סיימתם את שלב 6 כשמופיעה המילה `Done.`** מעליה מופיעה כתובת האפליקציה.

---

## שלב 7: פותחים בטלפון

כל אחד בטלפון שלו:

1. שולחים את כתובת האפליקציה לטלפון (למשל בוואטסאפ לעצמכם) ופותחים אותה.
2. לוחצים **המשך עם Google** ובוחרים את החשבון.
3. אם Google כותב שהאפליקציה לא אומתה, לוחצים **Continue**.
4. מאשרים את השם ולוחצים **המשך**.
5. מוסיפים למסך הבית:
   - **iPhone:** כפתור השיתוף ← **הוספה למסך הבית**
   - **Android:** ⋮ ← **התקנת אפליקציה**

🎉 **זהו! האפליקציה מוכנה.**

---

## פעם בחודש

האפליקציה תבקש **לחדש**. עושים שוב את שלב 3 ומדביקים את הקוד באפליקציה.

---

## עדכונים

גרסאות חדשות (תיקונים ושיפורים) מותקנות לבד, תוך 3 שעות מרגע שהן יוצאות. לא צריך לעשות כלום.
העדכונים עוברים דרך מאגר פרטי בחשבון ה־GitHub שלכם, `our-money-updates`. הנתונים שלכם לא עוברים ל־GitHub.

---

## משהו לא עבד?

| מה קרה | מה עושים |
|---|---|
| `Couldn't turn on automatic updates` / `The first update didn't finish` | האפליקציה עובדת. פותחים **Terminal**, מדביקים את שורת ה־`cd` משלב 4, ואז `node scripts/auto-update.mjs` ו־**Enter** |
| `RiseUp didn't accept this token` | עושים שוב את שלב 3 ומדביקים את הקוד החדש |
| `node` לא מוכר | עושים שוב את שלב 1, סוגרים את ה־Terminal ופותחים מחדש |
| `cannot find path` / `No such file` | עושים שוב את שלב 2 בדיוק כמו שכתוב |
| Google כותב `redirect_uri_mismatch` | בשלב 5.9 הכתובות לא הודבקו בדיוק. מדביקים שוב |
| Google כותב `Access blocked` | הכתובת לא נוספה ב־**Test users** (שלב 5.7) |
| באפליקציה כתוב "לחשבון הזה אין גישה" | נכנסתם עם Gmail אחר. לוחצים **כניסה עם חשבון אחר** |

**לא מוחקים את התיקייה `our-money-master`.** צריך אותה כדי להוסיף או להחליף אדם.

</div>
