# Eval results

16 answerable questions, 4 the corpus cannot answer. Top-k = 5, similarity threshold = 0.6, overlap = 50 tokens, embedding model window = 512 tokens.

## Retrieval

| Chunk size | Chunks | Avg tokens | Over model window | Hit@1 | Hit@5 | MRR | Unanswerable refused | Answerable wrongly refused | Best threshold |
|---|---|---|---|---|---|---|---|---|---|
| 300 | 31 | 226 | 0 | 69% | 94% | 0.79 | 2/4 | 0/16 | 0.63 (20/20) |
| 500 | 18 | 384 | 0 | 75% | 100% | 0.84 | 2/4 | 0/16 | 0.61 (19/20) |
| 800 | 13 | 531 | 8 | 50% | 94% | 0.66 | 3/4 | 0/16 | 0.60 (19/20) |

### Top similarity per question

| Question | 300: top sim / rank | 500: top sim / rank | 800: top sim / rank |
|---|---|---|---|
| What is the notice period for terminating a retainer? | 0.817 / 1 | 0.793 / 1 | 0.685 / 2 |
| How long do I have to pay an invoice? | 0.696 / 1 | 0.717 / 1 | 0.683 / 1 |
| What interest do you charge if we pay late? | 0.651 / 1 | 0.663 / 1 | 0.642 / 1 |
| When do we become the owner of the designs and code you deliver? | 0.675 / 8 | 0.647 / 3 | 0.666 / 3 |
| How long is the warranty for bugs after launch? | 0.636 / 3 | 0.654 / 5 | 0.731 / 3 |
| What is the maximum amount the Studio can be liable for? | 0.693 / 1 | 0.702 / 1 | 0.624 / 1 |
| How many hours a month does the Growth plan include? | 0.723 / 1 | 0.670 / 2 | 0.651 / 1 |
| What happens to retainer hours we don't use? | 0.743 / 4 | 0.737 / 3 | 0.736 / 1 |
| Can we pause our retainer over the summer? | 0.733 / 1 | 0.772 / 1 | 0.677 / 2 |
| What compensation do we get if you miss an urgent response time? | 0.709 / 2 | 0.748 / 1 | 0.742 / 1 |
| How long do you keep invoices and financial records? | 0.756 / 1 | 0.754 / 1 | 0.618 / 3 |
| Which countries is our personal data stored in? | 0.698 / 1 | 0.687 / 1 | 0.618 / 1 |
| How many rounds of design changes are included? | 0.702 / 2 | 0.689 / 1 | 0.676 / 1 |
| How long do we have to test the site before it counts as accepted? | 0.753 / 1 | 0.736 / 1 | 0.650 / 4 |
| How quickly are critical security updates to dependencies applied? | 0.685 / 1 | 0.677 / 1 | 0.655 / 7 |
| Is any setup time included when a retainer starts? | 0.774 / 1 | 0.777 / 1 | 0.717 / 5 |
| Does the Studio carry professional indemnity insurance? _(not in corpus)_ | 0.624 / — | 0.642 / — | 0.635 / — |
| Do you offer discounts for charities or nonprofits? _(not in corpus)_ | 0.526 / — | 0.494 / — | 0.497 / — |
| How much does managed hosting cost per month? _(not in corpus)_ | 0.617 / — | 0.607 / — | 0.592 / — |
| Who won the 2022 football World Cup? _(not in corpus)_ | 0.431 / — | 0.422 / — | 0.422 / — |
