import React, { useEffect, useState, useMemo } from 'react';
import '../../../App.css';
import './CuotasUsuarios.css';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import PrimaryButton from '../../../Components/utils/PrimaryButton/PrimaryButton';
import CustomInput from '../../../Components/utils/CustomInput/CustomInput';
import CustomDropdown from '../../../Components/utils/CustomDropdown/CustomDropdown';
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp';
import apiClient from '../../../axiosConfig';
import LoaderFullScreen from '../../../Components/utils/LoaderFullScreen/LoaderFullScreen';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import SecondaryButton from '../../../Components/utils/SecondaryButton/SecondaryButton';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, SlidersHorizontal, X } from 'lucide-react';
import apiService from '../../../services/apiService';
import { toast } from 'react-toastify';
import Select from 'react-select';

const cuotasSelectStyles = {
  control: (base, state) => ({
    ...base,
    width: '100%',
    minHeight: 44,
    borderRadius: 8,
    borderColor: state.isFocused ? 'rgba(218, 70, 50, 0.48)' : 'var(--border-color)',
    backgroundColor: 'var(--background-color-distinct)',
    boxShadow: state.isFocused ? '0 0 0 3px rgba(218, 70, 50, 0.12)' : 'none',
    color: 'var(--text-color)',
    fontSize: 14,
    ':hover': {
      borderColor: 'rgba(218, 70, 50, 0.48)'
    }
  }),
  menu: (base) => ({
    ...base,
    zIndex: 1001,
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    backgroundColor: 'var(--background-color)',
    boxShadow: '0 18px 40px rgba(0, 0, 0, 0.12)'
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? 'var(--background-hover-color)' : 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: 14
  }),
  singleValue: (base) => ({ ...base, color: 'var(--text-color)' }),
  input: (base) => ({ ...base, color: 'var(--text-color)' }),
  placeholder: (base) => ({ ...base, color: 'var(--text-color-distinct)' })
};

const usuarioToOption = (usuario) => ({
  value: usuario.ID_Usuario,
  label: `${usuario.nombre || ''} ${usuario.apellido || ''}${usuario.dni ? ` - DNI ${usuario.dni}` : usuario.email ? ` (${usuario.email})` : ''}`,
});

// Tamaño de lote para la generación masiva: cada request crea las cuotas+turnos de N alumnos.
// 25 mantiene cada request corta (sin riesgo de timeout en Vercel) y da progreso fluido.
const BULK_CHUNK_SIZE = 25;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Los turnos se guardan como wall-clock en UTC, así que se lee con getUTC* para mostrar la hora real.
const formatConflictFecha = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}hs`;
};

const CuotasUsuarios = () => {
  // — Estados de datos y carga —
  const [cuotas, setCuotas] = useState([]);
  const [planOptions, setPlanOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // — Estados de popup de crear/eliminar/pagar cuota —
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [actionType, setActionType] = useState(''); // 'pay' | 'delete'
  const [selectedCuota, setSelectedCuota] = useState(null);

  // — Estados del formulario “Nueva cuota” —
  const [selectedUserOpt, setSelectedUserOpt] = useState(null);
  const [userOptions, setUserOptions] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [mesDate, setMesDate] = useState(null);
  const [importe, setImporte] = useState('');
  const [venceDate, setVenceDate] = useState(null);

  // — Estados para carga masiva —
  const [bulkMesDate, setBulkMesDate] = useState(null);
  const [bulkVenceDate, setBulkVenceDate] = useState(null);
  const [validationResult, setValidationResult] = useState(null);

  // — Estado de la barra de progreso real de la generación masiva por lotes —
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ total: 0, procesados: 0, cuotas: 0, turnos: 0 });

  // — Estados de filtros (inputs) —
  const [inputEmail, setInputEmail] = useState('');
  const [inputDni, setInputDni] = useState('');
  const [inputEstado, setInputEstado] = useState(''); // '' | 'true' | 'false' | 'vencida'
  const [inputMesDate, setInputMesDate] = useState(null);
  const [inputPlan, setInputPlan] = useState('');

  // — Filtros aplicados + paginación —
  const [filterEmail, setFilterEmail] = useState('');
  const [filterDni, setFilterDni] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [filterMesDate, setFilterMesDate] = useState(null);
  const [filterPlan, setFilterPlan] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Pagar
  const [formaPago, setFormaPago] = useState('Efectivo');

  const opcionesFiltroEstado = ['Todos —', 'Pendiente', 'Pagada', 'Vencida'];
  const labelToEstado = label => {
    if (label === 'Pagada') return 'true';
    if (label === 'Pendiente') return 'pendiente';
    if (label === 'Vencida') return 'vencida';
    return '';
  };
  const estadoToLabel = estado => {
    if (estado === 'true') return 'Pagada';
    if (estado === 'pendiente') return 'Pendiente';
    if (estado === 'vencida') return 'Vencida';
    return 'Todos —';
  };

  const buildMesString = (dateObj) => {
    if (!dateObj) return '';
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    return `${year}-${month < 10 ? '0' + month : month}`;
  };

  const fetchPlanes = async () => {
    try {
      const planesRes = await apiService.getPlanes();
      setPlanOptions(planesRes || []);
    } catch (err) {
      console.error('Error obteniendo planes:', err);
    }
  };

  const fetchCuotas = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterEmail) params.email = filterEmail;
      if (filterDni) params.dni = filterDni;

      if (filterEstado === 'vencida') {
        params.vencida = true;
      } else if (filterEstado) {
        params.estado = filterEstado;
      }

      if (filterPlan) params.plan = filterPlan;
      if (filterMesDate) params.mes = buildMesString(filterMesDate);
      params.page = page;

      const response = await apiClient.get('/cuotas', { params });
      const lista = response.data.data || [];

      lista.sort((a, b) =>
        new Date(b.mes + '-01') - new Date(a.mes + '-01')
      );

      setCuotas(lista);
      setHasMore(lista.length > 0);
      setError(null);
    } catch (err) {
      console.error('Error al obtener cuotas:', err);
      setError(err);
      setCuotas([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlanes();
  }, []);

  useEffect(() => {
    const term = userSearch.trim();
    let isCurrentRequest = true;

    if (!showModal || term.length < 2) {
      setUserOptions([]);
      setUsersLoading(false);
      return () => { isCurrentRequest = false; };
    }

    setUsersLoading(true);
    const timeoutId = setTimeout(async () => {
      try {
        const response = await apiService.getAllUsuarios({
          page: 1,
          take: 20,
          tipo: 'cliente',
          estado: true,
          search: term
        });

        if (!isCurrentRequest) return;
        const options = Array.isArray(response?.data)
          ? response.data.map(usuarioToOption)
          : [];
        setUserOptions(options);
      } catch (err) {
        if (isCurrentRequest) {
          setUserOptions([]);
          console.error('Error buscando usuarios:', err);
          toast.error('No se pudieron buscar usuarios');
        }
      } finally {
        if (isCurrentRequest) setUsersLoading(false);
      }
    }, 300);

    return () => {
      isCurrentRequest = false;
      clearTimeout(timeoutId);
    };
  }, [showModal, userSearch]);

  useEffect(() => {
    fetchCuotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterEmail, filterDni, filterEstado, filterMesDate, filterPlan]);

  const openConfirmation = (type, cuota) => {
    setActionType(type);
    setSelectedCuota(cuota);
    if (type === 'pay') setFormaPago('Efectivo');
    setPopupOpen(true);
  };

  const closeConfirmation = () => {
    setPopupOpen(false);
    setActionType('');
    setSelectedCuota(null);
  };

  const handleConfirm = async () => {
    if (!selectedCuota) return;
    setLoading(true);
    try {
      if (actionType === 'pay') {
        await apiClient.put(`/cuotas/${selectedCuota.ID_Cuota}/pay`, { formaPago });
        toast.success(
          `Cuota pagada: cuota #${selectedCuota.ID_Cuota} por ${formatCurrency(selectedCuota.importe)} · ${formaPago}`
        );
      } else if (actionType === 'delete') {
        await apiClient.delete(`/cuotas/${selectedCuota.ID_Cuota}`);
        toast.success(`Cuota eliminada correctamente.`);
      }
      closeConfirmation();
      fetchCuotas();
    } catch (err) {
      console.error(err);
      const msg = err?.response?.data?.message
        || (actionType === 'pay'
          ? 'No se pudo registrar el pago.'
          : 'No se pudo eliminar la cuota.');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Helper: ISO UTC fin de día (evita drift por TZ)
  const toIsoUtcEndOfDay = (localDate) => {
    if (!localDate) return null;
    const y = localDate.getFullYear();
    const m = localDate.getMonth();
    const d = localDate.getDate();
    return new Date(Date.UTC(y, m, d, 23, 59, 59, 0)).toISOString();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (!selectedUserOpt?.value) {
      alert('Seleccioná un usuario válido.');
      setLoading(false);
      return;
    }
    if (!mesDate) {
      alert('Seleccioná un mes válido.');
      setLoading(false);
      return;
    }
    if (!venceDate) {
      alert('Seleccioná una fecha de vencimiento.');
      setLoading(false);
      return;
    }

    const mesString = buildMesString(mesDate);
    const venceIso = toIsoUtcEndOfDay(venceDate);

    const payload = { mes: mesString, importe: Number(importe), vence: venceIso };
    try {
      const resp = await apiClient.post(`/cuotas/usuario/${selectedUserOpt.value}`, payload);
      setSelectedUserOpt(null);
      setMesDate(null);
      setVenceDate(null);
      setImporte('');
      setPage(1);
      setShowModal(false);
      await fetchCuotas();
      const advertencias = resp?.data?.advertencias;
      if (advertencias) {
        toast.warning(advertencias.mensaje, { autoClose: 8000 });
      } else {
        toast.success('Cuota creada correctamente.');
      }
    } catch (err) {
      console.error('Error al crear cuota:', err);
      alert('No se pudo crear la cuota.');
    } finally {
      setLoading(false);
    }
  };

  // Generación masiva orquestada por lotes con progreso REAL.
  // Paso 1 (preparar): valida cupos globales y trae los IDs pendientes. Paso 2: procesa por lotes.
  const handleBulkGenerate = async () => {
    if (!bulkMesDate) { toast.error('Seleccioná un mes válido.'); return; }
    if (!bulkVenceDate) { toast.error('Seleccioná fecha de vencimiento.'); return; }

    const mes = buildMesString(bulkMesDate);
    const vence = toIsoUtcEndOfDay(bulkVenceDate);
    setShowBulkModal(false);

    // — Paso 1: preparar —
    let prep;
    try {
      setLoading(true);
      prep = await apiService.prepararCuotasMasivas({ mes, vence });
    } catch (err) {
      console.error('Error al preparar cuotas masivas:', err);
      const data = err?.response?.data;
      if (err?.response?.status === 409 && Array.isArray(data?.conflictosCupo)) {
        setValidationResult(data);
      } else {
        toast.error(data?.message || 'No se pudo preparar la generación de cuotas.');
      }
      return;
    } finally {
      setLoading(false);
    }

    if (!prep?.total) {
      toast.info(prep?.message || 'No hay cuotas nuevas para generar (ya estaban generadas).');
      return;
    }

    // — Paso 2: procesar por lotes con barra real —
    const ids = Array.isArray(prep.ids) ? prep.ids : [];
    const chunks = [];
    for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
      chunks.push(ids.slice(i, i + BULK_CHUNK_SIZE));
    }

    setBulkProgress({ total: prep.total, procesados: 0, cuotas: 0, turnos: 0 });
    setBulkRunning(true);

    let procesados = 0;
    let cuotasCreadas = 0;
    let turnosGenerados = 0;

    for (const chunk of chunks) {
      let ok = false;
      let lastErr = null;

      // Reintentar 1 vez ante un fallo transitorio (no ante 409 de cupo: no se resuelve reintentando).
      for (let intento = 0; intento < 2 && !ok; intento++) {
        try {
          const r = await apiService.generarCuotasLote({ mes, vence, ids: chunk });
          cuotasCreadas += r?.cuotasCreadas || 0;
          turnosGenerados += r?.turnosGenerados || 0;
          ok = true;
        } catch (e) {
          lastErr = e;
          if (e?.response?.status === 409) break;
          if (intento === 0) await sleep(800);
        }
      }

      if (!ok) {
        setBulkRunning(false);
        const data = lastErr?.response?.data;
        if (lastErr?.response?.status === 409 && Array.isArray(data?.conflictosCupo)) {
          setValidationResult(data);
        } else {
          toast.error(
            `Se generaron ${procesados} de ${prep.total} alumno(s). Volvé a tocar "Generar cuotas de este mes" para completar el resto (no se duplican).`,
            { autoClose: 9000 }
          );
        }
        setPage(1);
        fetchCuotas();
        return;
      }

      procesados += chunk.length;
      setBulkProgress({ total: prep.total, procesados, cuotas: cuotasCreadas, turnos: turnosGenerados });
    }

    setBulkRunning(false);
    setPage(1);
    fetchCuotas();
    toast.success(`Listo: ${cuotasCreadas} cuota(s) y ${turnosGenerados} turno(s) generados.`);
  };

  const applyFilters = () => {
    setPage(1);
    setFilterEmail(inputEmail.trim());
    setFilterDni(inputDni.trim());
    setFilterEstado(inputEstado);
    setFilterPlan(inputPlan);
    setFilterMesDate(inputMesDate);
  };

  const clearFilters = () => {
    setInputEmail('');
    setInputDni('');
    setInputEstado('');
    setInputPlan('');
    setInputMesDate(null);

    setPage(1);
    setFilterEmail('');
    setFilterDni('');
    setFilterEstado('');
    setFilterPlan('');
    setFilterMesDate(null);
  };

  const goPrevPage = () => { if (page > 1) setPage(prev => prev - 1); };
  const goNextPage = () => { if (hasMore) setPage(prev => prev + 1); };

  const formatMonth = (m) => {
    if (!m) return '–';
    const [year, month] = m.split('-').map(Number);
    return new Date(year, month - 1, 1)
      .toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  };
  const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-AR') : '–');
  const formatCurrency = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);

  const datePickerClass = 'custom-datepicker custom-datepicker-mes';

  const mergedUserOptions = useMemo(() => {
    const optionsById = new Map();
    [selectedUserOpt, ...userOptions].forEach(option => {
      if (option?.value) optionsById.set(option.value, option);
    });
    return Array.from(optionsById.values());
  }, [selectedUserOpt, userOptions]);

  return (
    <div className="page-layout">
      {loading && <LoaderFullScreen />}

      {bulkRunning && (
        <div className="cuotas-bulk-progress-overlay" role="alert" aria-busy="true">
          <div className="cuotas-bulk-progress-card">
            <h3>Generando cuotas y turnos…</h3>
            <p className="cuotas-bulk-progress-text">
              No cierres esta pantalla. Procesando {bulkProgress.procesados} de {bulkProgress.total} alumno(s).
            </p>
            <div className="cuotas-bulk-progress-track">
              <div
                className="cuotas-bulk-progress-fill"
                style={{ width: `${bulkProgress.total ? Math.round((bulkProgress.procesados / bulkProgress.total) * 100) : 0}%` }}
              />
            </div>
            <span className="cuotas-bulk-progress-pct">
              {bulkProgress.total ? Math.round((bulkProgress.procesados / bulkProgress.total) * 100) : 0}%
              {' · '}{bulkProgress.cuotas} cuota(s) · {bulkProgress.turnos} turno(s)
            </span>
          </div>
        </div>
      )}

      <SidebarMenu isAdmin={true} />

      <div className="content-layout">
        <div className="header-actions cuotas-usuarios" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Cuotas de Usuarios</h2>
          <div className='generate-cuotas-btns'>
            <PrimaryButton text="Generar cuotas de este mes" onClick={() => setShowBulkModal(true)} />
            <SecondaryButton text="Nueva cuota" onClick={() => setShowModal(true)} />
          </div>
        </div>

        <div className="cuotas-filters-toggle-row">
          <button
            className='toggle-filters-button'
            onClick={() => setShowFilters(prev => !prev)}
          >
            <SlidersHorizontal /> Filtros {showFilters ? <ChevronUp /> : <ChevronDown />}
          </button>
        </div>

        {showFilters && (
          <form
            className="cuotas-filtros-form"
            onSubmit={event => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <div className="cuotas-filtros-form-inputs-ctn">
              <label htmlFor="inputEmail">Email:</label>
              <CustomInput
                id="inputEmail"
                type="text"
                placeholder="Ej: valen@example.com"
                value={inputEmail}
                onChange={e => setInputEmail(e.target.value)}
              />
            </div>

            <div className="cuotas-filtros-form-inputs-ctn">
              <label htmlFor="inputDni">DNI:</label>
              <CustomInput
                id="inputDni"
                type="text"
                placeholder="Ej: 38444555"
                value={inputDni}
                onChange={e => setInputDni(e.target.value)}
              />
            </div>

            <div className="cuotas-filtros-form-inputs-ctn">
              <label htmlFor="inputEstado">Estado:</label>
              <CustomDropdown
                id="inputEstado"
                options={opcionesFiltroEstado}
                value={estadoToLabel(inputEstado)}
                onChange={e => setInputEstado(labelToEstado(e.target.value))}
              />
            </div>

            <div className="cuotas-filtros-form-inputs-ctn">
              <label>Mes:</label>
              <ReactDatePicker
                selected={inputMesDate}
                onChange={date => setInputMesDate(date)}
                dateFormat="MM/yyyy"
                showMonthYearPicker
                placeholderText="MM/AAAA"
                className={datePickerClass}
              />
            </div>

            <div className="cuotas-filtros-form-inputs-ctn">
              <label htmlFor="inputPlan">Plan:</label>
              <CustomDropdown
                id="inputPlan"
                options={planOptions.map(p => p.nombre)}
                placeholderOption="— Todos —"
                value={inputPlan}
                onChange={e => setInputPlan(e.target.value)}
              />
            </div>

            <div className="cuotas-filtros-form-actions">
              <button type="submit" className="primary-button">
                Aplicar filtros
              </button>
              <button type="button" className="secondary-button" onClick={clearFilters}>
                Limpiar filtros
              </button>
            </div>
          </form>
        )}

        {/* —— Tabla responsive —— */}
        {loading ? (
          <p>Cargando cuotas...</p>
        ) : error ? (
          <p className="text-error">Error cargando datos.</p>
        ) : cuotas.length === 0 ? (
          <p>No hay cuotas para mostrar.</p>
        ) : (
          <div className="table-responsive">
            <table className="cuotas-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Mes</th>
                  <th>Importe</th>
                  <th>Vence</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>Forma de Pago</th>
                  <th>Fecha Pago</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cuotas.map(c => (
                  <tr key={c.ID_Cuota}>
                    <td data-label="Usuario">
                      {c.User ? `${c.User.nombre} ${c.User.apellido}` : '–'}
                    </td>
                    <td data-label="Mes" className='cuotas-usuario-mes-col'>{formatMonth(c.mes)}</td>
                    <td data-label="Importe">{formatCurrency(c.importe)}</td>
                    <td data-label="Vence">{formatDate(c.vence)}</td>
                    <td data-label="Plan">{c.planNombreSnapshot ?? '–'}</td>
                    <td data-label="Estado">
                      <span
                        className={`badge ${c.vencida ? 'expired' : c.pagada ? 'paid' : 'pending'}`}
                      >
                        {c.vencida ? 'Vencida' : c.pagada ? 'Pagada' : 'Pendiente'}
                      </span>
                    </td>
                    <td data-label="Forma de Pago">{c.formaPago ? c.formaPago : '-'}</td>
                    <td data-label="Fecha Pago">{formatDate(c.fechaPago)}</td>
                    <td data-label="Acciones" className="acciones-cell">
                      <button
                        className="accion-button pay"
                        onClick={() => openConfirmation('pay', c)}
                        disabled={c.pagada}
                        aria-label={`Pagar cuota ${c.ID_Cuota}`}
                        title="Pagar"
                      >
                        Pagar
                      </button>
                      <button
                        className="accion-button delete"
                        onClick={() => openConfirmation('delete', c)}
                        aria-label={`Eliminar cuota ${c.ID_Cuota}`}
                        title="Eliminar"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* — Paginación — */}
        <div className="paginacion-controls" style={{ marginTop: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={goPrevPage} disabled={page === 1} className="btn-page" aria-label="Página anterior" title="Página anterior">
            <ChevronLeft />
          </button>
          <span>Página {page}</span>
          <button onClick={goNextPage} disabled={!hasMore} className="btn-page" aria-label="Página siguiente" title="Página siguiente">
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* — Modal Nueva cuota — */}
      {showModal && (
        <div
          className="cuotas-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowModal(false);
          }}
        >
          <div className="cuotas-modal" role="dialog" aria-modal="true" aria-labelledby="cuotas-modal-title">
            <form onSubmit={handleSubmit} className="modal-form">
              <div className="cuotas-modal-header">
                <div>
                  <h3 id="cuotas-modal-title">Nueva cuota</h3>
                  <span>Cargá una cuota individual para un usuario activo.</span>
                </div>
                <button type="button" className="cuotas-modal-close" onClick={() => setShowModal(false)} aria-label="Cerrar modal">
                  <X size={18} />
                </button>
              </div>

              <div className="cuotas-modal-grid">
                <div className="cuotas-modal-field cuotas-modal-field-wide">
                  <label>Usuario</label>
                  <Select
                    className="cuotas-select"
                    classNamePrefix="cuotas-select"
                    options={mergedUserOptions}
                    value={selectedUserOpt}
                    onChange={setSelectedUserOpt}
                    onInputChange={(value, meta) => {
                      if (meta.action === 'input-change') setUserSearch(value);
                    }}
                    placeholder="Seleccioná un usuario"
                    noOptionsMessage={() => userSearch.trim().length < 2 ? 'Escribí al menos 2 caracteres' : 'No se encontraron usuarios'}
                    loadingMessage={() => 'Buscando usuarios...'}
                    isClearable
                    isSearchable
                    isLoading={usersLoading}
                    filterOption={null}
                    menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                    styles={cuotasSelectStyles}
                  />
                </div>

                <div className="cuotas-modal-field">
                  <label>Mes</label>
                  <ReactDatePicker
                    selected={mesDate}
                    onChange={date => setMesDate(date)}
                    dateFormat="MM/yyyy"
                    showMonthYearPicker
                    placeholderText="Seleccioná mes y año"
                    className={datePickerClass}
                    required
                  />
                </div>

                <div className="cuotas-modal-field">
                  <label>Vence</label>
                  <ReactDatePicker
                    selected={venceDate}
                    onChange={date => setVenceDate(date)}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Seleccioná fecha de vencimiento"
                    className="custom-datepicker"
                    required
                  />
                </div>

                <div className="cuotas-modal-field cuotas-modal-field-wide">
                  <label>Importe</label>
                  <CustomInput
                    type="number"
                    placeholder="50000"
                    value={importe}
                    onChange={e => setImporte(e.target.value)}
                    required
                    width="100%"
                  />
                </div>
              </div>

              <div className="cuotas-modal-actions">
                <button type="button" className="cuotas-modal-secondary-button" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="cuotas-modal-primary-button">
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* — Modal Cuotas masivas — */}
      {showBulkModal && (
        <div
          className="cuotas-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowBulkModal(false);
          }}
        >
          <div className="cuotas-modal cuotas-modal-small" role="dialog" aria-modal="true" aria-labelledby="cuotas-bulk-modal-title">
            <div className="modal-form">
              <div className="cuotas-modal-header">
                <div>
                  <h3 id="cuotas-bulk-modal-title">Generar cuotas masivas</h3>
                  <span>Creá las cuotas del período para usuarios con turnos fijos.</span>
                </div>
                <button type="button" className="cuotas-modal-close" onClick={() => setShowBulkModal(false)} aria-label="Cerrar modal">
                  <X size={18} />
                </button>
              </div>

              <div className="cuotas-modal-grid">
                <div className="cuotas-modal-field">
                  <label>Mes</label>
                  <ReactDatePicker
                    selected={bulkMesDate}
                    onChange={date => setBulkMesDate(date)}
                    dateFormat="MM/yyyy"
                    showMonthYearPicker
                    placeholderText="MM/AAAA"
                    className={datePickerClass}
                  />
                </div>
                <div className="cuotas-modal-field">
                  <label>Vence</label>
                  <ReactDatePicker
                    selected={bulkVenceDate}
                    onChange={date => setBulkVenceDate(date)}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Seleccione fecha de vencimiento"
                    className="custom-datepicker"
                  />
                </div>
              </div>

              <div className="cuotas-modal-actions">
                <button type="button" className="cuotas-modal-secondary-button" onClick={() => setShowBulkModal(false)}>
                  Cancelar
                </button>
                <button type="button" className="cuotas-modal-primary-button" onClick={handleBulkGenerate}>
                  Generar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* — Popup confirmar — */}
      <ConfirmationPopup
        isOpen={popupOpen}
        onClose={closeConfirmation}
        onConfirm={handleConfirm}
        message={
          actionType === 'pay'
            ? `¿Confirmar pago de la cuota ${selectedCuota?.ID_Cuota}?`
            : `¿Estas seguro de eliminar la cuota? Si la cuota tiene turnos fijos asociados se eliminaran también.`
        }
      >
        {actionType === 'pay' && (
          <div className='form-input-ctn' style={{ margin: '1rem 0' }}>
            <label htmlFor="formaPago">Forma de pago</label>
            <CustomDropdown
              id="formaPago"
              value={formaPago}
              onChange={e => setFormaPago(e.target.value)}
              options={["Efectivo", "Tarjeta de crédito", "Tarjeta de débito", "Transferencia"]}
            />
          </div>
        )}
      </ConfirmationPopup>

      {validationResult && (
        <div
          className="cuotas-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setValidationResult(null);
          }}
        >
          <div className="cuotas-modal validation-modal" role="dialog" aria-modal="true" aria-labelledby="cuotas-validation-modal-title">
            <div className="cuotas-modal-header">
              <div>
                <h3 id="cuotas-validation-modal-title">Horarios sin cupo suficiente</h3>
                <span>No se generó ninguna cuota. Resolvé estos horarios y volvé a generar.</span>
              </div>
              <button type="button" className="cuotas-modal-close" onClick={() => setValidationResult(null)} aria-label="Cerrar modal">
                <X size={18} />
              </button>
            </div>
            <p className="validation-summary">
              Hay <strong>{validationResult.conflictosCupo?.length || 0}</strong> horario(s) donde los turnos fijos
              superan el cupo disponible. Liberá lugar o ajustá los turnos fijos de los alumnos afectados:
            </p>
            <div className="validation-problems-list">
              {(validationResult.conflictosCupo || []).map((c, i) => (
                <div key={i} className="validation-problem-card">
                  <strong>{c.clase || 'Clase'} · {c.diaSemana} {formatConflictFecha(c.fecha)}</strong>
                  <span>
                    Cupo {c.cupos} · ocupados {c.turnosExistentes} · solicitados {c.turnosSolicitados}
                    {' · '}exceso {c.exceso}
                  </span>
                  {Array.isArray(c.usuariosAfectados) && c.usuariosAfectados.length > 0 && (
                    <ul>
                      {c.usuariosAfectados.map(u => (
                        <li key={u.ID_Usuario}>{u.nombre}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="cuotas-modal-actions">
              <button
                type="button"
                className="cuotas-modal-primary-button"
                onClick={() => setValidationResult(null)}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CuotasUsuarios;
