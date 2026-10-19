# ai-model-sunset

Find the OpenAI and Anthropic models in your code that are being switched off, with the shutdown date and the official replacement.

```sh
npx -y github:ericc2005t/ai-model-sunset
```

```
gpt-3.5-turbo (OpenAI)  ▲ shuts down on 23 Oct 2026 (in 4 days)
  replace with gpt-5.6-terra
  src/bot.py:3  resp = client.chat.completions.create(model="gpt-3.5-turbo", messages=[])

gpt-4o-mini (OpenAI)  • shuts down on 14 Jan 2027 (in 87 days)
  replace with gpt-6-luna
  src/bot.py:4  summary = client.chat.completions.create(model="gpt-4o-mini", messages=[])
```

- **No dependencies.** One Node.js file (Node 18 or newer) and one data file, `models.json`.
- **Nothing is sent anywhere.** It reads files on your disk and prints a report. No telemetry, no network calls (the GitHub Action only calls the GitHub API, to open the issue).
- **Dates from the official pages.** Every date and replacement is copied from [OpenAI's deprecations page](https://developers.openai.com/api/docs/deprecations) and [Anthropic's model deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations). `npx -y github:ericc2005t/ai-model-sunset --version` prints the day they were last checked.

[Español más abajo](#español).

## Usage

```sh
npx -y github:ericc2005t/ai-model-sunset [path] [options]
```

| Option | What it does |
|---|---|
| `path` | Folder (or file) to scan. Default: the current folder. |
| `--lang en\|es` | Language of the report. Default: from `$LANG`. |
| `--json` | Print the result as JSON. |
| `--fail-within <days>` | Exit with code 1 if a model is already off or shuts down within `<days>`. Useful in CI. |
| `--include-docs` | Also scan `.md`, `.mdx`, `.txt` and `.rst` files (skipped by default). |
| `--today YYYY-MM-DD` | Pretend it's another day. |
| `--github` | GitHub Actions mode: annotations on the lines, a job summary and step outputs. |
| `--issue-within <days>` | With `--github`: open or update one issue when a model shuts down within `<days>`, and close it when none does. |

It skips `node_modules`, `.git`, build folders, virtualenvs, lockfiles, minified files, binaries and files over 2 MB.
Short names such as `o1` or `o3-mini` only count when they are quoted or assigned (`model="o1"`, `MODEL=o3-mini`), so a variable called `o1` isn't reported.

## GitHub Action

Add `.github/workflows/ai-model-sunset.yml` to your repository:

```yaml
name: AI model sunset check
on:
  schedule:
    - cron: '0 8 * * 1'   # every Monday
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ericc2005t/ai-model-sunset@v1
        with:
          issue-days: 60
```

Every week it scans the repository. When a model in your code shuts down within 60 days (or is already off), it opens an issue with the model, the date, the official replacement and links to the exact lines. It keeps that one issue up to date, and closes it when nothing is due any more.

| Input | Default | |
|---|---|---|
| `path` | `.` | Folder to scan. |
| `issue-days` | `60` | Open the issue when a model shuts down within this many days. `-1` = never open issues. |
| `fail-days` | (empty) | Fail the job when a model shuts down within this many days. Empty = never fail. |
| `lang` | `en` | `en` or `es`. |
| `include-docs` | `false` | Also scan Markdown and text files. |
| `token` | `github.token` | Needs `issues: write`. |

Outputs: `count`, `soonest-date`, `soonest-days`, `models`.

`@v1` follows the latest dates: the `v1` tag moves when the data is updated.

## What it can't see

- Model names built at run time (`"gpt-" + version`) or read from a database or a dashboard.
- Azure OpenAI, Amazon Bedrock and Google Cloud: they use their own deployment names and their own dates.
- Announcements made after the date shown by `--version`. Run it again from GitHub to get the latest data.

## Reminders by email

If you'd rather get an email 30 and 7 days before each shutdown, there is a free form at [promti.app/rescue-ai](https://promti.app/rescue-ai/#alerts). The same site has a checker you can paste an error into, a page per model with what changes in the code, and a paid fix if you'd rather not touch it. The scanner works the same without any of that.

## Updating the data

`models.json` is generated from the list behind promti.app's checker, so both always say the same thing. If a date is wrong or missing, open an issue with a link to the official page.

## Disclaimer

Not affiliated with, endorsed by or sponsored by OpenAI or Anthropic. Model names belong to their owners. Dates can change: the official pages are the reference.

MIT licence.

---

## Español

Encuentra en tu código los modelos de OpenAI y Anthropic que se apagan, con la fecha y el sustituto oficial.

```sh
npx -y github:ericc2005t/ai-model-sunset --lang es
```

- **Sin dependencias.** Un solo archivo de Node.js (Node 18 o posterior) y un archivo de datos, `models.json`.
- **No envía nada.** Lee los archivos de tu disco y muestra un informe. Sin telemetría ni llamadas a la red (la GitHub Action solo llama a la API de GitHub, para abrir el aviso).
- **Fechas de las páginas oficiales.** Cada fecha y cada sustituto salen de la [página de retiradas de OpenAI](https://developers.openai.com/api/docs/deprecations) y de la [de Anthropic](https://platform.claude.com/docs/en/about-claude/model-deprecations). `--version` dice qué día se comprobaron.

### Opciones

| Opción | Qué hace |
|---|---|
| `ruta` | Carpeta (o archivo) que revisar. Por defecto, la actual. |
| `--lang en\|es` | Idioma del informe. Por defecto, el de `$LANG`. |
| `--json` | El resultado en JSON. |
| `--fail-within <días>` | Sale con código 1 si un modelo ya está apagado o se apaga en menos de `<días>`. Útil en CI. |
| `--include-docs` | Revisa también `.md`, `.mdx`, `.txt` y `.rst` (por defecto no). |
| `--github` | Modo GitHub Actions: avisos en las líneas, resumen del job y salidas. |
| `--issue-within <días>` | Con `--github`: abre o actualiza un *issue* cuando un modelo se apaga en menos de `<días>`, y lo cierra cuando ya no queda ninguno. |

Se salta `node_modules`, `.git`, las carpetas de build, los entornos virtuales, los *lockfiles*, los minificados, los binarios y los archivos de más de 2 MB.

### GitHub Action

Copia el flujo de arriba en `.github/workflows/ai-model-sunset.yml` y añade `lang: es`. Cada lunes revisa el repositorio y, si un modelo de tu código se apaga en menos de 60 días, abre un *issue* con el modelo, la fecha, el sustituto oficial y enlaces a las líneas. Mantiene ese único *issue* al día y lo cierra cuando ya no hace falta.

### Lo que no ve

- Nombres de modelo construidos al ejecutar (`"gpt-" + version`) o guardados en una base de datos o un panel.
- Azure OpenAI, Amazon Bedrock y Google Cloud: tienen sus propios nombres y sus propias fechas.
- Anuncios posteriores a la fecha de `--version`. Vuelve a ejecutarlo desde GitHub para tener los datos al día.

### Avisos por email

Si prefieres un email 30 y 7 días antes de cada apagado, hay un formulario gratuito en [promti.app/es/rescate-ia](https://promti.app/es/rescate-ia/#avisos). En la misma web hay un comprobador donde pegar un error, una página por modelo con lo que cambia en el código y, si prefieres no tocarlo, el arreglo de pago. El escáner funciona igual sin nada de eso.

### Aviso

Sin relación con OpenAI ni con Anthropic, que no lo patrocinan ni lo respaldan. Los nombres de los modelos son de sus dueños. Las fechas pueden cambiar: la referencia son las páginas oficiales.

Licencia MIT.
