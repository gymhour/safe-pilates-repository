import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { toast } from 'react-toastify';
import apiService from '../../../services/apiService';
import CustomDropdown from '../CustomDropdown/CustomDropdown';

const normalizeDay = (d) =>
  String(d || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// JS Date.getDay(): 0=domingo ... 6=sábado
const DAY_INDEX = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

const formatHora = (iso) => String(iso || '').substr(11, 5);

/**
 * Flujo "Eliminar y reprogramar" (solo admin):
 * Paso 1: confirma el borrado FÍSICO de un turno AUSENTE/CANCELADO (libera sesión y día).
 * Paso 2: crea un turno nuevo para el mismo alumno (clase → horario → fecha).
 *
 * Props:
 *  - isOpen
 *  - user:  { id, nombre }
 *  - turno: { id, label }  (label descriptivo: "Lunes 09/06 07:00 · CrossFit")
 *  - onClose()
 *  - onDeleted()  → refrescar la lista del caller apenas se borra
 */
const ReprogramarTurnoModal = ({ isOpen, user, turno, onClose, onDeleted }) => {
  const [step, setStep] = useState('confirm'); // 'confirm' | 'create'
  const [loading, setLoading] = useState(false);
  const [clases, setClases] = useState([]);
  const [selectedClaseId, setSelectedClaseId] = useState('');
  const [selectedHorarioId, setSelectedHorarioId] = useState('');
  const [fecha, setFecha] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep('confirm');
    setSelectedClaseId('');
    setSelectedHorarioId('');
    setFecha(null);
    apiService
      .getClases()
      .then((data) => setClases(Array.isArray(data) ? data : []))
      .catch(() => toast.error('No se pudieron cargar las clases.'));
  }, [isOpen]);

  const claseSeleccionada = useMemo(
    () => clases.find((c) => String(c.ID_Clase) === String(selectedClaseId)),
    [clases, selectedClaseId]
  );

  const horariosDisponibles = useMemo(
    () => (claseSeleccionada?.HorariosClase || []).filter((h) => h.activo !== false),
    [claseSeleccionada]
  );

  const horarioSeleccionado = useMemo(
    () => horariosDisponibles.find((h) => String(h.ID_HorarioClase) === String(selectedHorarioId)),
    [horariosDisponibles, selectedHorarioId]
  );

  if (!isOpen || !user || !turno) return null;

  const handleEliminar = async () => {
    setLoading(true);
    try {
      await apiService.deleteTurnoFisico(turno.id);
      toast.success('Turno eliminado definitivamente.');
      onDeleted?.();
      setStep('create');
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar el turno.');
    } finally {
      setLoading(false);
    }
  };

  const handleCrear = async () => {
    if (!horarioSeleccionado || !fecha) {
      toast.error('Seleccioná clase, horario y fecha.');
      return;
    }
    const [hh, mm] = formatHora(horarioSeleccionado.horaIni).split(':').map(Number);
    const fechaIso = new Date(
      Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), hh || 0, mm || 0, 0, 0)
    ).toISOString();

    setLoading(true);
    try {
      await apiService.postTurno({
        ID_Usuario: user.id,
        ID_HorarioClase: Number(horarioSeleccionado.ID_HorarioClase),
        fecha: fechaIso,
      });
      toast.success(`Turno nuevo creado para ${user.nombre}.`);
      onClose();
    } catch (err) {
      // Errores de negocio del backend (sin cupo / tope del período / cuota): se muestran y el
      // modal queda abierto para elegir otro horario.
      toast.error(err.message || 'No se pudo crear el turno.');
    } finally {
      setLoading(false);
    }
  };

  const diaIdxHorario = horarioSeleccionado
    ? DAY_INDEX[normalizeDay(horarioSeleccionado.diaSemana)]
    : null;

  return (
    <div
      className="cuotas-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cuotas-modal cuotas-modal-small" role="dialog" aria-modal="true" aria-labelledby="reprogramar-turno-title">
        <div className="modal-form">
          <div className="cuotas-modal-header">
            <div>
              <h3 id="reprogramar-turno-title">
                {step === 'confirm' ? 'Eliminar y reprogramar turno' : 'Crear turno nuevo'}
              </h3>
              <span>
                {step === 'confirm'
                  ? `Alumno: ${user.nombre}`
                  : `El turno anterior fue eliminado. Elegí el nuevo turno para ${user.nombre}.`}
              </span>
            </div>
            <button type="button" className="cuotas-modal-close" onClick={onClose} aria-label="Cerrar modal">
              <X size={18} />
            </button>
          </div>

          {step === 'confirm' ? (
            <>
              <p style={{ margin: '16px 0 4px', fontSize: 14, lineHeight: 1.5, color: 'var(--text-color-distinct)' }}>
                Se eliminará <strong style={{ color: 'var(--text-color)' }}>definitivamente</strong> el turno:
              </p>
              <p style={{ margin: '4px 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--text-color)' }}>
                {turno.label}
              </p>
              <p style={{ margin: '0 0 6px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-color-distinct)' }}>
                Esto libera la sesión del período y el día, y a continuación vas a poder crearle un turno nuevo.
              </p>

              <div className="cuotas-modal-actions">
                <button type="button" className="cuotas-modal-secondary-button" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="cuotas-modal-primary-button"
                  style={{ backgroundColor: '#e5484d', borderColor: '#e5484d' }}
                  onClick={handleEliminar}
                  disabled={loading}
                >
                  {loading ? 'Eliminando…' : 'Eliminar turno'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="cuotas-modal-grid">
                <div className="cuotas-modal-field">
                  <label>Clase</label>
                  <CustomDropdown
                    options={clases.map((c) => ({ value: String(c.ID_Clase), label: c.nombre }))}
                    value={selectedClaseId}
                    onChange={(e) => {
                      setSelectedClaseId(e.target.value);
                      setSelectedHorarioId('');
                      setFecha(null);
                    }}
                    placeholderOption="Seleccioná una clase"
                  />
                </div>

                <div className="cuotas-modal-field">
                  <label>Horario</label>
                  <CustomDropdown
                    options={horariosDisponibles.map((h) => ({
                      value: String(h.ID_HorarioClase),
                      label: `${h.diaSemana} ${formatHora(h.horaIni)} - ${formatHora(h.horaFin)}`,
                    }))}
                    value={selectedHorarioId}
                    onChange={(e) => {
                      setSelectedHorarioId(e.target.value);
                      setFecha(null);
                    }}
                    placeholderOption={selectedClaseId ? 'Seleccioná un horario' : 'Elegí una clase primero'}
                  />
                </div>

                <div className="cuotas-modal-field cuotas-modal-field-wide">
                  <label>Fecha {horarioSeleccionado ? `(solo ${horarioSeleccionado.diaSemana})` : ''}</label>
                  <ReactDatePicker
                    selected={fecha}
                    onChange={(d) => setFecha(d)}
                    dateFormat="dd/MM/yyyy"
                    placeholderText={horarioSeleccionado ? 'Seleccioná la fecha' : 'Elegí un horario primero'}
                    className="custom-datepicker"
                    minDate={new Date()}
                    filterDate={(d) => diaIdxHorario === null || d.getDay() === diaIdxHorario}
                    disabled={!horarioSeleccionado}
                  />
                </div>
              </div>

              <div className="cuotas-modal-actions">
                <button type="button" className="cuotas-modal-secondary-button" onClick={onClose}>
                  Omitir (no crear turno)
                </button>
                <button
                  type="button"
                  className="cuotas-modal-primary-button"
                  onClick={handleCrear}
                  disabled={loading || !horarioSeleccionado || !fecha}
                >
                  {loading ? 'Creando…' : 'Crear turno'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReprogramarTurnoModal;
