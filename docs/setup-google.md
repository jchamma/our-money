<div dir="rtl">

# התקנה עם כניסת Google

כל אחד נכנס עם חשבון Google שלו. זה דורש פרויקט ב־Google Cloud, כ־10 דקות יותר מ־[Passkeys](setup-passkeys.md). **אם אין לכם סיבה מיוחדת, Passkeys פשוטות יותר.**

## 1–3. Node.js, הקוד וטוקן RiseUp

בדיוק כמו בשלבים 1–3 של [המדריך ל־Passkeys](setup-passkeys.md#1-מתקינים-nodejs).

## 4. מריצים את ההתקנה

```
npm run setup
```

| השאלה | מה עונים |
|---|---|
| חלון דפדפן של Cloudflare | נכנסים או נרשמים (חינם, בלי כרטיס) ולוחצים **Allow**. |
| `How will you log in?` | `2` (Google). |
| `How many people` | `2` לזוג, `1` אם רק אתם. |
| `Person 1: Google account` | כתובת ה־Gmail של כל אחד. **רק הכתובות האלו יוכלו להיכנס.** |
| `RiseUp token (hidden)` | מדביקים את הטוקן ולוחצים Enter. |
| `Name for this copy` | Enter, או שם באנגלית קטנה. |

אחרי שהאפליקציה עולה, ההתקנה עוצרת ומציגה שתי כתובות. **השאירו את הטרמינל פתוח** ועברו לשלב 5.

```
  Google: create an OAuth client (type "Web application") in Google Cloud with:
    Authorized JavaScript origin:  https://our-money.<שם>.workers.dev
    Authorized redirect URI:       https://our-money.<שם>.workers.dev/auth/google/callback
  Client ID:
```

## 5. יוצרים כניסת Google ב־Google Cloud

1. נכנסים ל־[console.cloud.google.com](https://console.cloud.google.com) עם חשבון Google (של אחד מכם).
2. למעלה בוחרים **Select a project › New project**, קוראים לו `our-money` ולוחצים **Create**. מוודאים שהוא הפרויקט הנבחר.
3. בתפריט: **Google Auth Platform › Get started**.
   - **App name:** `הכסף שלנו`. **User support email:** המייל שלכם. **Next**.
   - **Audience:** **External**. **Next**.
   - **Contact information:** המייל שלכם. **Next**, מסכימים לתנאים, **Create**.
4. **Audience › Test users › Add users:** מוסיפים את שתי כתובות ה־Gmail מההתקנה ולוחצים **Save**.

   משאירים את האפליקציה במצב **Testing**. כך Google עצמו מכניס רק את שתי הכתובות האלו: שכבת הגנה שנייה.
5. **Clients › Create client:**
   - **Application type:** **Web application**. **Name:** `our-money`.
   - **Authorized JavaScript origins › Add URI:** הכתובת הראשונה מהטרמינל.
   - **Authorized redirect URIs › Add URI:** הכתובת השנייה (זו שמסתיימת ב־`/auth/google/callback`).
   - **Create**.
6. בחלון שנפתח מעתיקים את **Client ID** ואת **Client secret**.

## 6. מסיימים את ההתקנה

חוזרים לטרמינל:

| השאלה | מה עונים |
|---|---|
| `Client ID` | מדביקים (מסתיים ב־`.apps.googleusercontent.com`). |
| `Client secret (hidden)` | מדביקים (לא יופיע על המסך). |

**הצלחה:**

```
[7/7] Open the app
  Open https://our-money.<שם>.workers.dev on your phone and log in with …
  Done.
```

## 7. נכנסים מהטלפון

1. פותחים את הכתובת בטלפון ולוחצים **המשך עם Google**.
2. בוחרים את החשבון. Google יכול להזהיר שהאפליקציה לא אומתה: זה צפוי במצב Testing. לוחצים **Continue**.
3. מאשרים או משנים את השם שלכם ולוחצים **המשך**.
4. מתקינים למסך הבית: ב־iPhone, שיתוף › **הוספה למסך הבית**; ב־Android, ⋮ › **התקנת אפליקציה**.

## אחר כך

- **להוסיף או להחליף אדם:** `npm run add-person` / `npm run remove-person`. בכתובת חדשה צריך להוסיף אותה גם ב־**Audience › Test users**.
- **גרסה חדשה:** `git pull` (או הורדה מחדש), `npm install`, `npm run update`.

## אם משהו לא עובד

| מה רואים | מה עושים |
|---|---|
| `Error 400: redirect_uri_mismatch` | הכתובת בשלב 5 לא זהה. מעתיקים אותה שוב מהטרמינל, בלי `/` בסוף הראשונה. |
| `Access blocked` / `403: access_denied` | הכתובת לא ברשימת **Test users**. מוסיפים אותה. |
| "לחשבון הזה אין גישה" | נכנסתם עם Gmail שלא הוזן בהתקנה. **כניסה עם חשבון אחר**. |
| הטרמינל נסגר לפני שלב 6 | מריצים `npx wrangler secret put GOOGLE_CLIENT_ID` ומדביקים כשמתבקשים, ואז אותו דבר עם `GOOGLE_CLIENT_SECRET`. זהו, אין צורך בהתקנה מחדש. |

</div>
