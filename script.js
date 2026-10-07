// Inicializa os ícones do Lucide
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
});

let dadosGlobaisST = [];

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("xml-files");
const loadingContainer = document.getElementById("loading-container");
const loadingText = document.getElementById("loading-text");
const statsPanel = document.getElementById("stats-panel");
const resultsContainer = document.getElementById("results-container");
const tableBody = document.getElementById("table-body");
const searchInput = document.getElementById("search-input");

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("border-blue-500", "bg-blue-50");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("border-blue-500", "bg-blue-50");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("border-blue-500", "bg-blue-50");
  if (e.dataTransfer.files.length > 0) {
    processarLoteXMLs(e.dataTransfer.files);
  }
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    processarLoteXMLs(e.target.files);
  }
});

// MATRIZ DE REGRAS DO ESTADO DO RIO DE JANEIRO (RICMS/RJ e Convênio ICMS 142/2018)
const REGRAS_ST_RJ = {
  22021000: { desc: "Refrigerantes", mva: 45.0, aliquota: 0.2 },
  22030000: { desc: "Cervejas e Chopes", mva: 56.12, aliquota: 0.22 },
  87089990: { desc: "Autopeças diversas", mva: 35.0, aliquota: 0.2 },
  33030010: { desc: "Perfumes e águas-de-colônia", mva: 40.0, aliquota: 0.2 },
  48202000: { desc: "Cadernos escolares", mva: 30.0, aliquota: 0.18 },
};

async function processarLoteXMLs(files) {
  loadingContainer.classList.remove("hidden");
  statsPanel.classList.add("hidden");
  resultsContainer.classList.add("hidden");
  dadosGlobaisST = [];

  let notasComST = 0;
  let notasSemST = 0;
  let arquivosComErroTecnico = 0;
  let totalValorST = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    loadingText.textContent = `Auditando ST (RJ) - Arquivo ${i + 1} de ${files.length}: ${file.name}`;

    try {
      const text = await file.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      // Verifica se é um XML de NF-e válido
      const nfeTag =
        xmlDoc.getElementsByTagName("NFe")[0] ||
        xmlDoc.getElementsByTagName("nfeProc")[0];
      const parserError = xmlDoc.getElementsByTagName("parsererror")[0];
      if (!nfeTag || parserError) {
        throw new Error(
          "Arquivo XML corrompido ou estrutura de NF-e inválida.",
        );
      }

      const ide = xmlDoc.getElementsByTagName("ide")[0];
      const nNF = ide?.getElementsByTagName("nNF")[0]?.textContent || "N/D";

      const emit = xmlDoc.getElementsByTagName("emit")[0];
      const xNomeEmit =
        emit?.getElementsByTagName("xNome")[0]?.textContent || "Desconhecido";

      const detElements = xmlDoc.getElementsByTagName("det");
      if (!detElements || detElements.length === 0) {
        throw new Error("NF-e sem itens de produtos.");
      }

      let itensIdentificadosNestaNota = 0;

      for (let det of detElements) {
        const prod = det.getElementsByTagName("prod")[0];
        const cProd = prod?.getElementsByTagName("cProd")[0]?.textContent || "";
        const xProd = prod?.getElementsByTagName("xProd")[0]?.textContent || "";
        const ncm =
          prod?.getElementsByTagName("NCM")[0]?.textContent?.trim() || "";
        const cfop =
          prod?.getElementsByTagName("CFOP")[0]?.textContent?.trim() || "";
        const uCom = prod?.getElementsByTagName("uCom")[0]?.textContent || "";
        const qCom = parseFloat(
          prod?.getElementsByTagName("qCom")[0]?.textContent || "0",
        );
        const vProd = parseFloat(
          prod?.getElementsByTagName("vProd")[0]?.textContent || "0",
        );
        const vFrete = parseFloat(
          prod?.getElementsByTagName("vFrete")[0]?.textContent || "0",
        );

        const imposto = det.getElementsByTagName("imposto")[0];
        const icmsTag = imposto?.getElementsByTagName("ICMS")[0];

        let codigoFiscal = "";
        let vBCST = 0;
        let vICMSST = 0;
        let stOmitidaFornecedor = false;

        if (icmsTag && icmsTag.children.length > 0) {
          const icmsSubTag = icmsTag.children[0];
          const cst =
            icmsSubTag.getElementsByTagName("CST")[0]?.textContent || "";
          const csosn =
            icmsSubTag.getElementsByTagName("CSOSN")[0]?.textContent || "";
          codigoFiscal = cst || csosn;

          vBCST = parseFloat(
            icmsSubTag.getElementsByTagName("vBCST")[0]?.textContent ||
              icmsSubTag.getElementsByTagName("vBCSTRet")[0]?.textContent ||
              "0",
          );
          vICMSST = parseFloat(
            icmsSubTag.getElementsByTagName("vICMSST")[0]?.textContent ||
              icmsSubTag.getElementsByTagName("vICMSSTRet")[0]?.textContent ||
              "0",
          );
        }

        // CRITÉRIO RIGOROSO DE AUDITORIA DE ST:
        const cstsST = ["10", "30", "60", "70", "201", "202", "203", "500"];
        const ehCstSTExplicito = cstsST.includes(codigoFiscal);
        const ehNCMST = REGRAS_ST_RJ.hasOwnProperty(ncm);

        if (ehNCMST && !ehCstSTExplicito && vICMSST === 0 && vBCST === 0) {
          stOmitidaFornecedor = true;
          const regra = REGRAS_ST_RJ[ncm];
          vBCST = (vProd + vFrete) * (1 + regra.mva / 100);
          vICMSST = vBCST * regra.aliquota - vProd * 0.12;
          if (vICMSST < 0) vICMSST = 0;
          codigoFiscal = codigoFiscal
            ? `${codigoFiscal} (Omitido)`
            : "NÃO INFORMADO";
        }

        if (ehCstSTExplicito || vICMSST > 0 || stOmitidaFornecedor) {
          dadosGlobaisST.push({
            arquivo: file.name,
            numeroNota: nNF,
            emitente: xNomeEmit,
            codigo: cProd,
            descricao: xProd,
            ncm: ncm,
            cfop: cfop,
            quantidade: qCom,
            unidade: uCom,
            codigoTributo: codigoFiscal,
            baseCalculoST: vBCST,
            valorICMSST: vICMSST,
            alertaOmissao: stOmitidaFornecedor,
          });
          totalValorST += vICMSST;
          itensIdentificadosNestaNota++;
        }
      }

      if (itensIdentificadosNestaNota > 0) {
        notasComST++;
      } else {
        notasSemST++; // Nota válida, mas sem ST
      }
    } catch (err) {
      console.warn(`Aviso no arquivo ${file.name}:`, err.message);
      arquivosComErroTecnico++;
    }
  }

  // Atualiza os cards estatísticos no HTML
  document.getElementById("stat-notas").textContent = notasComST;
  document.getElementById("stat-itens").textContent = dadosGlobaisST.length;
  document.getElementById("stat-valortotal").textContent =
    totalValorST.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  // Mostramos de forma detalhada na interface os erros técnicos vs notas sem ST
  const cardErros = document.getElementById("stat-erros");
  if (cardErros) {
    cardErros.innerHTML = `
            <span class="text-red-600">${arquivosComErroTecnico} Erros</span> / 
            <span class="text-gray-600">${notasSemST} Sem ST</span>
        `;
  }

  loadingContainer.classList.add("hidden");
  statsPanel.classList.remove("hidden");
  resultsContainer.classList.remove("hidden");

  renderizarTabela(dadosGlobaisST);
}

function renderizarTabela(dados) {
  tableBody.innerHTML = "";
  if (dados.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-gray-500">Nenhum item tributável por ST encontrado.</td></tr>`;
    return;
  }

  dados.forEach((item) => {
    const tr = document.createElement("tr");
    const badgeAlerta = item.alertaOmissao
      ? `<span class="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded font-bold ml-1" title="Fornecedor omitiu a ST no XML. Capturado por regra de NCM/RJ.">⚠️ ST OMITIDA PELO FORNECEDOR</span>`
      : "";

    tr.className = item.alertaOmissao
      ? "bg-amber-50/60 hover:bg-amber-50 border-b border-gray-100"
      : "hover:bg-gray-50 border-b border-gray-100";
    tr.innerHTML = `
            <td class="p-3">
                <span class="font-semibold text-gray-800">NF ${item.numeroNota}</span>
                <div class="text-xs text-gray-500 truncate max-w-xs" title="${item.emitente}">${item.emitente}</div>
            </td>
            <td class="p-3 font-mono text-xs">${item.codigo}</td>
            <td class="p-3 font-medium text-gray-800 max-w-xs truncate" title="${item.descricao}">
                ${item.descricao} ${badgeAlerta}
            </td>
            <td class="p-3 font-mono text-xs">${item.ncm} (CFOP: ${item.cfop})</td>
            <td class="p-3">${item.quantidade} ${item.unidade}</td>
            <td class="p-3"><span class="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded font-semibold">${item.codigoTributo}</span></td>
            <td class="p-3 font-mono">R$ ${item.baseCalculoST.toFixed(2)}</td>
            <td class="p-3 font-mono font-bold text-emerald-600">R$ ${item.valorICMSST.toFixed(2)}</td>
        `;
    tableBody.appendChild(tr);
  });
}

searchInput.addEventListener("input", (e) => {
  const termo = e.target.value.toLowerCase();
  const filtrados = dadosGlobaisST.filter(
    (item) =>
      item.descricao.toLowerCase().includes(termo) ||
      item.ncm.includes(termo) ||
      item.numeroNota.includes(termo) ||
      item.codigo.toLowerCase().includes(termo),
  );
  renderizarTabela(filtrados);
});

document.getElementById("btn-export-excel").addEventListener("click", () => {
  if (dadosGlobaisST.length === 0) return alert("Não há dados para exportar.");
  const worksheet = XLSX.utils.json_to_sheet(
    dadosGlobaisST.map((i) => ({
      "Nota Fiscal": i.numeroNota,
      Emitente: i.emitente,
      Código: i.codigo,
      Descrição: i.descricao,
      NCM: i.ncm,
      CFOP: i.cfop,
      Qtd: i.quantidade,
      Unidade: i.unidade,
      "CST/CSOSN": i.codigoTributo,
      "Base ST Apurada": i.baseCalculoST,
      "Valor ICMS ST Apurado": i.valorICMSST,
      "Status Omissão": i.alertaOmissao
        ? "ST Omitida pelo Fornecedor (Capturada por Regra)"
        : "Normal",
      Arquivo: i.arquivo,
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Auditoria ST Omitida RJ");
  XLSX.writeFile(workbook, "Relatorio_Auditoria_ST_Omitida.xlsx");
});

document.getElementById("btn-export-csv").addEventListener("click", () => {
  if (dadosGlobaisST.length === 0) return alert("Não há dados para exportar.");
  let csvContent =
    "data:text/csv;charset=utf-8,Nota;Emitente;Codigo;Descricao;NCM;CFOP;Qtd;Un;CST;BaseST;ValorST;Status\n";
  dadosGlobaisST.forEach((i) => {
    csvContent += `"${i.numeroNota}","${i.emitente}","${i.codigo}","${i.descricao}","${i.ncm}","${i.cfop}",${i.quantidade},"${i.unidade}","${i.codigoTributo}",${i.baseCalculoST},${i.valorICMSST},"${i.alertaOmissao ? "OMITIDA" : "NORMAL"}"\n`;
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "Relatorio_Auditoria_ST_Omitida.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});
