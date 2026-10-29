# Torneo di briscola in cinque

Pagina statica in italiano, senza framework o dipendenze. La pubblicazione viene eseguita da GitHub Actions dopo l'importazione del file Excel.

## Aggiornare i risultati dall'Excel

Carica il file **`Briscola_League_Automatica.xlsx`** nella cartella principale oppure in `data/`; il workflow riconosce entrambe le posizioni. Nella scheda `Risultati`, i giocatori sono sulle righe e le 12 date sulle colonne: scegli il piazzamento dal menu a tendina accanto al nome, lascia la cella vuota per un'assenza e seleziona il giocatore jolly nella riga apposita in fondo. Non assegnare lo stesso piazzamento due volte nella stessa giornata; le duplicazioni vengono evidenziate e bloccano l'importazione. La scheda `Classifica` aggiorna presenze, piazzamenti, punti lordi, scarti e totale netto; la scheda `Dettaglio` mostra i punti per giocatore e giornata; la scheda `Regole` riporta l'elenco giocatori e i punti F1.

Il convertitore continua a supportare anche il modello precedente con i piazzamenti in colonne.

Dopo aver modificato il file Excel sul computer, salva il workbook, caricalo o sostituiscilo nel repository GitHub e registra la modifica su `main` (ad esempio con un commit). GitHub Actions importerà automaticamente le 12 date e i piazzamenti, aggiornerà `data/torneo.json` e pubblicherà il sito aggiornato su GitHub Pages. Non modificare direttamente `data/torneo.json`: è generato dal foglio Excel.

La prima volta, configura GitHub Pages in **Settings → Pages**, selezionando **GitHub Actions** come sorgente di pubblicazione. In **Settings → Actions → General → Workflow permissions**, abilita **Read and write permissions**, necessario per il commit automatico del JSON generato. Se le regole di protezione di `main` vietano i commit da GitHub Actions, il workflow non potrà salvare il JSON aggiornato.

Il workflow si può anche avviare manualmente da **Actions → Import tournament results from Excel → Run workflow**, scegliendo il branch `main`. Il file Excel deve essere già stato caricato nella cartella principale o in `data/`. Gli errori (date mancanti, nomi non riconosciuti, piazzamenti duplicati o un jolly non associato a un partecipante) interrompono l'importazione invece di pubblicare una classifica incompleta.

Le date sono memorizzate in JSON nel formato `AAAA-MM-GG`. Una serata con meno di cinque piazzamenti è registrata ma non è valida e non entra nella classifica. Il jolly può essere usato una sola volta da ogni giocatore nell'intero torneo.

Il punteggio per serata è di 5 punti presenza più i punti F1 del piazzamento; il jolly raddoppia solo i punti F1. La classifica mostra presenze, vittorie, secondi posti, terzi posti, punti lordi, Scarto 1, Scarto 2 e punti netti. I punti netti sottraggono i due risultati peggiori tra le serate valide, comprese le assenze da zero; gli scarti vengono calcolati solo sulle serate valide. In caso di pari punti i giocatori condividono la posizione.

Per visualizzare la pagina in locale, avvia un server statico dalla cartella del repository, ad esempio `python -m http.server 8000`, poi apri `http://localhost:8000`. Aprire `index.html` direttamente come file non carica il JSON perché il browser blocca le richieste `fetch` da `file://`.
