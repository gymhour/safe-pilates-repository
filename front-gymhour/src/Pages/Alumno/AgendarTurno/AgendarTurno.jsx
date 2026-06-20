import React, { useState, useEffect } from 'react';
import '../../../App.css';
import './agendarTurno.css';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import { useLocation } from 'react-router-dom';
import CustomDropdown from '../../../Components/utils/CustomDropdown/CustomDropdown';
import apiService from '../../../services/apiService';
import PrimaryButton from '../../../Components/utils/PrimaryButton/PrimaryButton';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import LoaderFullScreen from '../../../Components/utils/LoaderFullScreen/LoaderFullScreen';
import { toast } from 'react-toastify';
import { registerLocale } from 'react-datepicker';
import es from 'date-fns/locale/es';
import 'react-datepicker/dist/react-datepicker.css';
registerLocale('es', es);

// ————————————————————————————————————————————————
// Día → índice (tolerante a tildes y mayúsculas)
// ————————————————————————————————————————————————
const diaIndex = (nombre) => {
  if (!nombre) return null;
  const t = nombre
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')                // separa diacríticos
    .replace(/[\u0300-\u036f]/g, ''); // quita diacríticos

  switch (t) {
    case 'domingo':   return 0;
    case 'lunes':     return 1;
    case 'martes':    return 2;
    case 'miercoles': return 3; // cubre "Miércoles" y "Miercoles"
    case 'jueves':    return 4;
    case 'viernes':   return 5;
    case 'sabado':    return 6; // cubre "Sábado" y "Sabado"
    default:          return null;
  }
};

const getHorarioDateParts = (value) => {
  if (!value) return { hours: 0, minutes: 0 };
  const str = value.toString();

  if (str.includes('T')) {
    const date = new Date(str);
    return {
      hours: date.getUTCHours(),
      minutes: date.getUTCMinutes(),
    };
  }

  const [rawHours = '0', rawMinutes = '0'] = str.split(':');
  return {
    hours: Number(rawHours),
    minutes: Number(rawMinutes),
  };
};

const getNextDateForHorario = (horario) => {
  const targetDay = diaIndex(horario?.diaSemana);
  if (targetDay === null) return null;

  const now = new Date();
  const selected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (targetDay - selected.getDay() + 7) % 7;
  const { hours, minutes } = getHorarioDateParts(horario.horaIni);

  selected.setDate(selected.getDate() + offset);
  selected.setHours(hours, minutes, 0, 0);

  if (selected <= now) {
    selected.setDate(selected.getDate() + 7);
  }

  return selected;
};

const AgendarTurno = () => {
  const location = useLocation();
  const [clases, setClases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedClase, setSelectedClase] = useState('');
  const [selectedDateTime, setSelectedDateTime] = useState(null);
  const [isAgendando, setIsAgendando] = useState(false);
  const [preselectionApplied, setPreselectionApplied] = useState(false);

  useEffect(() => {
    const fetchClases = async () => {
      setLoading(true);
      try {
        const clasesApi = await apiService.getClases();
        setClases(clasesApi);
      } catch (err) {
        toast.error("Error al cargar las clases. Intente nuevamente.");
      } finally {
        setLoading(false);
      }
    };

    fetchClases();
  }, []);

  useEffect(() => {
    if (preselectionApplied || clases.length === 0 || !location.state) return;

    const { selectedClaseId, selectedClaseNombre, selectedHorarioId } = location.state;
    const clasePreseleccionada = clases.find((clase) => {
      const matchesId = selectedClaseId && Number(clase.ID_Clase) === Number(selectedClaseId);
      const matchesName = selectedClaseNombre && clase.nombre === selectedClaseNombre;
      return matchesId || matchesName;
    });

    if (!clasePreseleccionada) {
      setPreselectionApplied(true);
      return;
    }

    setSelectedClase(clasePreseleccionada.nombre);

    const horarioPreseleccionado = (clasePreseleccionada.HorariosClase ?? []).find(
      (horario) => Number(horario.ID_HorarioClase) === Number(selectedHorarioId)
    );

    if (horarioPreseleccionado) {
      setSelectedDateTime(getNextDateForHorario(horarioPreseleccionado));
    }

    setPreselectionApplied(true);
  }, [clases, location.state, preselectionApplied]);

  const clasesOptions = clases.map((clase) => clase.nombre);

  // Filtra fechas: hoy a +7 días y días permitidos según horarios ACTIVOS
  const filterDate = (date) => {
    const now = new Date();

    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const maxDateRaw = new Date();
    maxDateRaw.setDate(now.getDate() + 7);
    const maxDateOnly = new Date(
      maxDateRaw.getFullYear(),
      maxDateRaw.getMonth(),
      maxDateRaw.getDate()
    );

    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dateOnly < todayOnly || dateOnly > maxDateOnly) {
      return false;
    }

    if (selectedClase) {
      const clase = clases.find(c => c.nombre === selectedClase);
      if (!clase) return false;

      const activos = (clase.HorariosClase ?? []).filter(h => h.activo !== false);
      if (activos.length === 0) return false;

      const allowedDays = activos
        .map(h => diaIndex(h.diaSemana))
        .filter(d => d !== null);

      if (!allowedDays.includes(date.getDay())) return false;

      // Si es hoy, asegurar que haya al menos un horario futuro
      if (dateOnly.getTime() === todayOnly.getTime()) {
        const hasFutureSlot = activos.some(h => {
          const utcInicio = new Date(h.horaIni);
          const localStart = new Date(dateOnly);
          // Usamos las horas/min de UTCHours como "hora de pared"
          localStart.setHours(
            utcInicio.getUTCHours(),
            utcInicio.getUTCMinutes(),
            0, 0
          );
          return localStart > now;
        });
        return hasFutureSlot;
      }
      return true;
    }

    return true;
  };

  // Genera todos los horarios de inicio permitidos para el día seleccionado (uno por cada horario ACTIVO)
  const getAllowedTimes = (date) => {
    if (!date || !selectedClase) return [];
    const dia = date.getDay();
    const clase = clases.find(c => c.nombre === selectedClase);
    if (!clase) return [];

    const horariosDia = (clase.HorariosClase ?? [])
      .filter(h => h.activo !== false && diaIndex(h.diaSemana) === dia);

    if (horariosDia.length === 0) return [];

    const now = new Date();
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const isToday = dateOnly.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const allowedStarts = horariosDia
      .map(h => {
        const utcInicio = new Date(h.horaIni);
        const localStart = new Date(date);
        // Copiamos la hora/min de UTC como "hora local" visible (no tocamos tu lógica)
        localStart.setHours(utcInicio.getUTCHours(), utcInicio.getUTCMinutes(), 0, 0);
        return localStart;
      })
      .filter(t => !isToday || t > now) // si es hoy, solo futuros
      .sort((a, b) => a - b);

    return allowedStarts;
  };

  // Helper para formatear fecha local como ISO sin zona (mantiene tu comportamiento)
  const formatLocalISO = (date) => {
    const pad = n => String(n).padStart(2, '0');
    return [
      date.getFullYear(),
      '-', pad(date.getMonth() + 1),
      '-', pad(date.getDate()),
      'T', pad(date.getHours()),
      ':', pad(date.getMinutes()),
      ':', pad(date.getSeconds())
    ].join('');
  };

  const manejarSeleccionClase = (e) => {
    const nombreClaseSeleccionada = e.target.value;
    setSelectedClase(nombreClaseSeleccionada);
    setSelectedDateTime(null); // reiniciamos al cambiar de clase
  };

  const manejarAgendarTurno = async () => {
    // Validaciones sin activar loader para no “pegar” la UI en errores tempranos
    if (!selectedClase || !selectedDateTime) {
      toast.error("Por favor, selecciona una clase y un turno (fecha y hora) disponibles.");
      return;
    }

    const usuarioId = localStorage.getItem("usuarioId");
    if (!usuarioId) {
      toast.error("Usuario no autenticado.");
      return;
    }

    const claseSeleccionada = clases.find((clase) => clase.nombre === selectedClase);
    if (!claseSeleccionada) {
      toast.error("Clase seleccionada no válida.");
      return;
    }

    const day = selectedDateTime.getDay();
    // Horarios activos del mismo día
    const horariosMismoDia = (claseSeleccionada.HorariosClase ?? [])
      .filter(h => h.activo !== false && diaIndex(h.diaSemana) === day);

    if (horariosMismoDia.length === 0) {
      toast.error("No hay horario disponible para ese día.");
      return;
    }

    // Encontrar el horario cuyo "inicio" coincide con la hora elegida en el picker
    // (misma lógica de hora local = UTCHours/UTCMinutes)
    const horarioElegido = horariosMismoDia.find(h => {
      const utcInicio = new Date(h.horaIni);
      const hh = utcInicio.getUTCHours();
      const mm = utcInicio.getUTCMinutes();
      return (hh === selectedDateTime.getHours() && mm === selectedDateTime.getMinutes());
    });

    if (!horarioElegido) {
      toast.error("No pudimos identificar el horario seleccionado. Probá elegir nuevamente la hora.");
      return;
    }

    const body = {
      ID_Usuario: parseInt(usuarioId, 10),
      ID_HorarioClase: horarioElegido.ID_HorarioClase,
      fecha: formatLocalISO(selectedDateTime),
    };

    setIsAgendando(true);
    setLoading(true);
    try {
      console.log("body que envio", body);
      await apiService.postTurno(body);
      setSelectedClase('');
      setSelectedDateTime(null);
      toast.success("Turno agendado exitosamente.");
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "No se pudo agendar el turno.");
    } finally {
      setIsAgendando(false);
      setLoading(false);
    }
  };

  return (
    <div className='page-layout'>
      {loading && <LoaderFullScreen />}
      <SidebarMenu isAdmin={false} />
      <div className='content-layout'>
        <h2 className='agendar-turno-title'>Agendar turno</h2>
        <div className="agendar-turno-ctn">
          {!loading && (
            <CustomDropdown
              options={clasesOptions}
              value={selectedClase}
              onChange={manejarSeleccionClase}
              placeholderOption='Clase'
            />
          )}

          <div className="datepicker-container">
            <DatePicker
              selected={selectedDateTime}
              onChange={(date) => setSelectedDateTime(date)}
              showTimeSelect
              dateFormat="dd/MM/yyyy h:mm aa"
              timeFormat="h:mm aa"
              locale="es"
              timeCaption="Hora"
              placeholderText="Selecciona fecha y hora"
              filterDate={filterDate}
              includeTimes={selectedDateTime ? getAllowedTimes(selectedDateTime) : []}
              minDate={new Date()}
              maxDate={(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; })()}
              className="custom-date-picker-input"
              disabled={!selectedClase}
            />
          </div>

          <PrimaryButton
            onClick={manejarAgendarTurno}
            text={isAgendando ? 'Agendando...' : 'Agendar turno'}
          />
        </div>
      </div>
    </div>
  );
};

export default AgendarTurno;
