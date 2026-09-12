# Eval results

16 answerable questions, 4 the corpus cannot answer. Top-k = 5, similarity threshold = 0.6, overlap = 50 tokens, embedding model window = 512 tokens.

## Retrieval

| Chunk size | Chunks | Avg tokens | Over model window | Hit@1 | Hit@5 | MRR | Unanswerable refused | Answerable wrongly refused | Best threshold |
|---|---|---|---|---|---|---|---|---|---|
| 500 | 18 | 384 | 0 | 75% | 100% | 0.84 | 2/4 | 0/16 | 0.61 (19/20) |

### Top similarity per question

| Question | 500: top sim / rank |
|---|---|
| What is the notice period for terminating a retainer? | 0.793 / 1 |
| How long do I have to pay an invoice? | 0.717 / 1 |
| What interest do you charge if we pay late? | 0.663 / 1 |
| When do we become the owner of the designs and code you deliver? | 0.647 / 3 |
| How long is the warranty for bugs after launch? | 0.654 / 5 |
| What is the maximum amount the Studio can be liable for? | 0.702 / 1 |
| How many hours a month does the Growth plan include? | 0.670 / 2 |
| What happens to retainer hours we don't use? | 0.737 / 3 |
| Can we pause our retainer over the summer? | 0.772 / 1 |
| What compensation do we get if you miss an urgent response time? | 0.748 / 1 |
| How long do you keep invoices and financial records? | 0.754 / 1 |
| Which countries is our personal data stored in? | 0.687 / 1 |
| How many rounds of design changes are included? | 0.689 / 1 |
| How long do we have to test the site before it counts as accepted? | 0.736 / 1 |
| How quickly are critical security updates to dependencies applied? | 0.677 / 1 |
| Is any setup time included when a retainer starts? | 0.777 / 1 |
| Does the Studio carry professional indemnity insurance? _(not in corpus)_ | 0.642 / — |
| Do you offer discounts for charities or nonprofits? _(not in corpus)_ | 0.494 / — |
| How much does managed hosting cost per month? _(not in corpus)_ | 0.607 / — |
| Who won the 2022 football World Cup? _(not in corpus)_ | 0.422 / — |

## Full pipeline

Run against the indexed database with the live model (openai/gpt-oss-20b).

| Metric | Value |
|---|---|
| Answerable questions answered with a correct citation | 14/16 |
| Answerable questions wrongly refused | 0/16 |
| Unanswerable questions refused | 3/4 |
| Refusals made without calling the model | 2 |
| Refusals made by the model (NOT_IN_DOCUMENTS) | 1 |
| Refusal rate overall | 15% |
| Errors | 0 |
| Avg latency, all questions | 18.90s |
| Avg latency, answered questions | 20.84s |
| Avg estimated cost per answered question | $0.00069 |
